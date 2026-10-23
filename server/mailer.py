"""Transactional outbox. Sending is retried; an email failure never loses an order."""
from contextlib import closing
from datetime import datetime, timezone
from email.message import EmailMessage
import smtplib
import ssl
import time

from .app import Store, utcnow


def send_pending(config, limit=20, transport=None):
    if not config.mail_enabled:
        return {'sent':0,'failed':0,'configured':False}
    store=Store(config)
    sent=failed=0
    for _ in range(limit):
        now=int(time.time())
        with closing(store.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            job=db.execute("SELECT * FROM outbox WHERE state IN ('pending','retry','sending') AND next_attempt<=? AND lease_until<=? AND attempts<8 ORDER BY id LIMIT 1",(now,now)).fetchone()
            if not job:
                db.rollback();break
            db.execute("UPDATE outbox SET state='sending',lease_until=?,attempts=attempts+1 WHERE id=?",(now+300,job['id']))
            order=db.execute('SELECT * FROM orders WHERE id=?',(job['order_id'],)).fetchone()
            items=db.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY id',(job['order_id'],)).fetchall()
            db.commit()
        message=EmailMessage()
        message['From']=config.mail_from
        message['To']=config.mail_to
        message['Subject']='Новый заказ Юрмани '+order['number']
        # A stable Message-ID assists deduplication if a process stops after SMTP acceptance.
        message['Message-ID']='<'+order['number'].lower()+'@'+config.origin.split('://')[-1].split(':')[0]+'>'
        lines=[f"Заказ {order['number']}",f"Создан: {order['created_at']}",f"Клиент: {order['customer_name']}",f"Телефон: {order['phone']}",f"Город: {order['city']}",('Доставка: '+order['address']) if order['fulfillment']=='delivery' else 'Самовывоз','']
        for i,p in enumerate(items,1):
            lines.append(f"{i}. {p['name']} — {p['quantity']}; цена по прайсу {p['price_cents']/100:.2f} ₽")
        lines += ['',f"Предварительная сумма: {order['total_cents']/100:.2f} ₽",'Единицы продажи, фасовку, наличие и итоговую сумму нужно подтвердить.',f"Комментарий: {order['comment']}",'',config.origin+'/manager/#order='+str(order['id'])]
        message.set_content('\n'.join(lines))
        try:
            if transport:
                transport(message)
            else:
                context=ssl.create_default_context()
                if config.smtp_mode=='ssl':
                    connection=smtplib.SMTP_SSL(config.smtp_host,config.smtp_port,timeout=25,context=context)
                else:
                    connection=smtplib.SMTP(config.smtp_host,config.smtp_port,timeout=25)
                    connection.ehlo();connection.starttls(context=context);connection.ehlo()
                with connection:
                    if config.smtp_user:
                        connection.login(config.smtp_user,config.smtp_password)
                    connection.send_message(message)
            with closing(store.connect()) as db,db:
                db.execute("UPDATE outbox SET state='sent',lease_until=0,last_error='',sent_at=? WHERE id=?",(utcnow(),job['id']))
            sent+=1
        except Exception as exc:
            # Store an exception type only: SMTP errors can contain account addresses or credentials.
            attempt=job['attempts']+1
            with closing(store.connect()) as db,db:
                db.execute('UPDATE outbox SET state=?,lease_until=0,next_attempt=?,last_error=? WHERE id=?',('failed' if attempt>=8 else 'retry',now+min(3600,60*2**attempt),type(exc).__name__,job['id']))
            failed+=1
    return {'sent':sent,'failed':failed,'configured':True}
