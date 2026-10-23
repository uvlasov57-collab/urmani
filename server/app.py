"""Portable WSGI order service. No customer records or secrets live in the web root."""
from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from hashlib import scrypt, sha256
from http import HTTPStatus
from http.cookies import SimpleCookie, CookieError
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, unquote
import hmac
import html
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time

STATUSES = {'new':'Новый','contacted':'Связались','confirmed':'Подтверждён','completed':'Выполнен','cancelled':'Отменён'}
CONSENT_VERSION = 'orders-v1-2026-10-23'
COOKIE = 'urmani_session'
MAX_BODY = 160_000


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def digest(value):
    return sha256(value.encode()).hexdigest()


def password_hash(password):
    salt = secrets.token_bytes(16)
    value = scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return 'scrypt$' + salt.hex() + '$' + value.hex()


def verify_password(password, stored):
    try:
        method, salt, expected = stored.split('$')
        if method != 'scrypt':
            return False
        actual = scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


@dataclass
class Config:
    root: Path
    data_dir: Path
    origin: str = 'http://127.0.0.1:8000'
    production: bool = False
    operator_name: str = 'Юрмани (ИП)'
    operator_email: str = 'union161@yandex.ru'
    trust_proxy: bool = False
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_mode: str = 'starttls'
    smtp_user: str = ''
    smtp_password: str = ''
    mail_from: str = ''
    mail_to: str = ''

    @classmethod
    def from_env(cls):
        root = Path(__file__).resolve().parents[1]
        return cls(root=root, data_dir=Path(os.getenv('URMANI_DATA_DIR', str(root.parent/'urmani-orders-data'))),
            origin=os.getenv('URMANI_ORIGIN','http://127.0.0.1:8000').rstrip('/'),
            production=os.getenv('URMANI_PRODUCTION')=='1',
            operator_name=os.getenv('URMANI_OPERATOR_NAME','Юрмани (ИП)'),
            operator_email=os.getenv('URMANI_OPERATOR_EMAIL','union161@yandex.ru'),
            trust_proxy=os.getenv('URMANI_TRUST_PROXY')=='1',
            smtp_host=os.getenv('URMANI_SMTP_HOST',''),smtp_port=int(os.getenv('URMANI_SMTP_PORT','587')),
            smtp_mode=os.getenv('URMANI_SMTP_MODE','starttls'),smtp_user=os.getenv('URMANI_SMTP_USER',''),
            smtp_password=os.getenv('URMANI_SMTP_PASSWORD',''),mail_from=os.getenv('URMANI_MAIL_FROM',''),
            mail_to=os.getenv('URMANI_MAIL_TO',''))

    @property
    def mail_enabled(self):
        return bool(self.smtp_host and self.mail_from and self.mail_to)


class ApiError(Exception):
    def __init__(self, status, message, **details):
        self.status, self.message, self.details = status, message, details


class Store:
    def __init__(self, config):
        self.config = config
        self.root = config.root.resolve()
        self.data = config.data_dir.resolve()
        if self.data == self.root or self.root in self.data.parents:
            raise ValueError('URMANI_DATA_DIR must be outside the site/repository directory')
        self.data.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.data/'orders.sqlite3'
        with closing(self.connect()) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript((self.root/'server/schema.sql').read_text(encoding='utf-8'))
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
        self.products = {}
        for i,p in enumerate(json.loads((self.root/'products.json').read_text(encoding='utf-8'))):
            key = str(p.get('id') or p.get('slug') or p['name'])
            if key in self.products:
                key += '::'+p['image']
            if key in self.products:
                key += '::'+str(i)
            self.products[key] = {**p,'key':key,'price_cents':int((Decimal(str(p['price']))*100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))}

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.create_function('CASEFOLD',1,lambda value: str(value or '').casefold(), deterministic=True)
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=15000')
        return db

    def create_user(self, login, name, password):
        if not re.fullmatch(r'[a-zA-Z0-9._-]{3,60}',login):
            raise ValueError('Login: 3–60 Latin letters, digits, dot, dash or underscore')
        if len(password)<12 or len(password)>256:
            raise ValueError('Password must contain 12–256 characters')
        with closing(self.connect()) as db, db:
            db.execute('INSERT INTO users(login,name,password_hash) VALUES(?,?,?)',(login,name[:100],password_hash(password)))

    def limit(self, db, scope, identity, maximum, seconds):
        epoch = int(time.time())
        bucket = scope+':'+digest(identity)+':'+str(epoch//seconds)
        db.execute('DELETE FROM rate_limits WHERE expires_at<?',(epoch,))
        db.execute('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1',(bucket,epoch+seconds*2))
        count = db.execute('SELECT count FROM rate_limits WHERE bucket=?',(bucket,)).fetchone()[0]
        if count > maximum:
            raise ApiError(429,'Слишком много попыток. Подождите и попробуйте позже.')


class Application:
    def __init__(self, config):
        self.config, self.store = config, Store(config)
        # Comparable work for unknown usernames, without recording a shared/default password.
        self.dummy_hash = password_hash(secrets.token_urlsafe(32))
        if config.production:
            if not config.origin.startswith('https://'):
                raise ValueError('Production requires URMANI_ORIGIN with HTTPS')
            if not config.operator_name.strip() or config.operator_name == 'Юрмани (ИП)':
                raise ValueError('Set URMANI_OPERATOR_NAME to the registered individual entrepreneur name')
            with closing(self.store.connect()) as db:
                if not db.execute('SELECT 1 FROM users WHERE active=1').fetchone():
                    raise ValueError('Create a manager account before starting the production service')
        if config.smtp_mode not in ['starttls','ssl']:
            raise ValueError('URMANI_SMTP_MODE must be starttls or ssl')

    def json(self, status, value, headers=()):
        body = json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
        return status, [('Content-Type','application/json; charset=utf-8'),('Cache-Control','no-store'),*headers], body

    def read_json(self, env):
        if env.get('CONTENT_TYPE','').split(';')[0] != 'application/json':
            raise ApiError(415,'Нужен формат application/json.')
        try:
            size = int(env.get('CONTENT_LENGTH','0'))
        except ValueError:
            raise ApiError(400,'Некорректный запрос.')
        if size <= 0 or size > MAX_BODY:
            raise ApiError(413,'Слишком большой или пустой запрос.')
        try:
            value = json.loads(env['wsgi.input'].read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (ValueError,UnicodeError):
            raise ApiError(400,'Не удалось прочитать запрос.')
        if not isinstance(value,dict):
            raise ApiError(400,'Некорректные данные.')
        return value

    def check_origin(self, env):
        origin = env.get('HTTP_ORIGIN','')
        if origin != self.config.origin:
            raise ApiError(403,'Откройте форму на сайте и попробуйте ещё раз.')

    def client_ip(self,env):
        if self.config.trust_proxy:
            # Only deploy behind the bundled proxy, which overwrites this header.
            return env.get('HTTP_X_REAL_IP',env.get('REMOTE_ADDR','unknown'))
        return env.get('REMOTE_ADDR','unknown')

    def session(self,env,db):
        cookie=SimpleCookie()
        try:
            cookie.load(env.get('HTTP_COOKIE',''))
            token=cookie[COOKIE].value
        except (KeyError,ValueError,CookieError):
            raise ApiError(401,'Войдите в кабинет менеджера.')
        row=db.execute('SELECT s.*,u.name,u.login FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1',(digest(token),int(time.time()))).fetchone()
        if not row:
            raise ApiError(401,'Сессия истекла. Войдите снова.')
        return row

    def cookie(self, token='', expire=False):
        secure='; Secure' if self.config.production or self.config.origin.startswith('https://') else ''
        return ('Set-Cookie',f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if expire else 28800}{secure}')

    def text(self, value, name, maximum, minimum=0):
        if not isinstance(value,str):
            raise ApiError(400,f'Проверьте поле «{name}».')
        value=value.strip()
        if len(value)<minimum or len(value)>maximum or any(ord(c)<32 and c not in '\n\t' for c in value):
            raise ApiError(400,f'Проверьте поле «{name}».')
        return value

    def normalize_order(self,body):
        if body.get('website'):
            raise ApiError(400,'Не удалось отправить заказ. Позвоните менеджеру.')
        if body.get('consent') is not True or body.get('consent_version')!=CONSENT_VERSION:
            raise ApiError(400,'Подтвердите согласие на обработку данных для заказа.')
        customer=body.get('customer')
        if not isinstance(customer,dict):
            raise ApiError(400,'Заполните контактные данные.')
        phone=re.sub(r'[^0-9]','',self.text(customer.get('phone',''),'Телефон',30,10))
        if len(phone)==11 and phone.startswith('8'):
            phone='7'+phone[1:]
        if len(phone)==10:
            phone='7'+phone
        if len(phone)!=11 or not phone.startswith('7') or len(set(phone))<3:
            raise ApiError(400,'Укажите телефон в формате +7 и 10 цифр.')
        fulfillment=body.get('fulfillment')
        if fulfillment not in ['delivery','pickup']:
            raise ApiError(400,'Выберите доставку или самовывоз.')
        address=self.text(customer.get('address',''),'Адрес',500,5 if fulfillment=='delivery' else 0)
        items=body.get('items')
        if not isinstance(items,list) or not 1<=len(items)<=200:
            raise ApiError(400,'В заказе должно быть от 1 до 200 разных товаров.')
        lines=[]
        seen=set()
        for item in items:
            if not isinstance(item,dict):
                raise ApiError(400,'Проверьте состав заказа.')
            key=item.get('key')
            if not isinstance(key,str) or key not in self.store.products:
                raise ApiError(409,'Ассортимент обновился. Вернитесь в каталог и проверьте товары.')
            if key in seen:
                raise ApiError(400,'В заказе повторяется один и тот же товар.')
            seen.add(key)
            quantity=item.get('quantity')
            if type(quantity) is not int or not 1<=quantity<=999999:
                raise ApiError(400,'Количество должно быть целым числом от 1 до 999999.')
            p=self.store.products[key]
            lines.append({'key':key,'name':p['name'],'image':p['image'],'quantity':quantity,'price_cents':p['price_cents']})
        attribution={}
        raw=body.get('attribution',{})
        if isinstance(raw,dict):
            for k in ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','source','referrer_host','landing_path']:
                if isinstance(raw.get(k),str):
                    attribution[k]=raw[k][:250]
        return {'customer_name':self.text(customer.get('name',''),'Имя',100,2),'phone':'+'+phone,
            'city':self.text(customer.get('city',''),'Город',120,2),'address':address if fulfillment=='delivery' else '',
            'fulfillment':fulfillment,'comment':self.text(body.get('comment',''),'Комментарий',2000),
            'items':lines,'total_cents':sum(p['quantity']*p['price_cents'] for p in lines),'attribution':attribution}

    def create_order(self,env,body,db):
        token=env.get('HTTP_IDEMPOTENCY_KEY','')
        if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}',token):
            raise ApiError(400,'Обновите форму заказа и повторите отправку.')
        request_hash=digest(json.dumps(body,ensure_ascii=False,sort_keys=True))
        idem=digest(token)
        db.execute('BEGIN IMMEDIATE')
        previous=db.execute('SELECT number,request_hash,total_cents FROM orders WHERE idempotency_hash=?',(idem,)).fetchone()
        if previous:
            if previous['request_hash']!=request_hash:
                raise ApiError(409,'Заказ с этим запросом уже сохранён. Обновите форму для нового заказа.')
            db.commit()
            return self.json(200,{'number':previous['number'],'total_cents':previous['total_cents'],'saved':True})
        value=self.normalize_order(body)
        if type(body.get('expected_total_cents')) is not int or body['expected_total_cents']!=value['total_cents']:
            raise ApiError(409,'Цены в прайсе обновились. Проверьте новую сумму и отправьте заказ ещё раз.',code='PRICE_CHANGED',total_cents=value['total_cents'],items=value['items'])
        self.store.limit(db,'orders-ip',self.client_ip(env),12,3600)
        self.store.limit(db,'orders-phone',value['phone'],6,3600)
        now=utcnow()
        row=db.execute('INSERT INTO orders(created_at,updated_at,customer_name,phone,city,fulfillment,address,comment,total_cents,attribution,consent_version,consent_at,idempotency_hash,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (now,now,value['customer_name'],value['phone'],value['city'],value['fulfillment'],value['address'],value['comment'],value['total_cents'],json.dumps(value['attribution'],ensure_ascii=False),CONSENT_VERSION,now,idem,request_hash))
        order_id=row.lastrowid
        number=f'UR-{datetime.now(timezone(timedelta(hours=3))):%Y%m%d}-{order_id:05d}'
        db.execute('UPDATE orders SET number=? WHERE id=?',(number,order_id))
        db.executemany('INSERT INTO order_items(order_id,product_key,name,image,quantity,price_cents) VALUES(?,?,?,?,?,?)',[(order_id,p['key'],p['name'],p['image'],p['quantity'],p['price_cents']) for p in value['items']])
        db.execute('INSERT INTO history(order_id,created_at,actor,event,note) VALUES(?,?,?,?,?)',(order_id,now,'Клиент','created','Заказ принят с сайта'))
        db.execute('INSERT INTO outbox(order_id) VALUES(?)',(order_id,))
        db.commit()
        return self.json(201,{'number':number,'total_cents':value['total_cents'],'saved':True})

    def order_detail(self,db,order_id):
        row=db.execute('SELECT o.*,u.name AS assignee_name,b.state AS email_status FROM orders o LEFT JOIN users u ON u.id=o.assignee_id LEFT JOIN outbox b ON b.order_id=o.id WHERE o.id=?',(order_id,)).fetchone()
        if not row:
            raise ApiError(404,'Заказ не найден.')
        value=dict(row)
        for k in ['idempotency_hash','request_hash']:
            value.pop(k,None)
        value['attribution']=json.loads(value['attribution'])
        value['items']=[dict(x) for x in db.execute('SELECT product_key,name,image,quantity,price_cents FROM order_items WHERE order_id=? ORDER BY id',(order_id,))]
        value['history']=[dict(x) for x in db.execute('SELECT created_at,actor,event,note FROM history WHERE order_id=? ORDER BY id DESC',(order_id,))]
        return value

    def api(self,env,path,method,db):
        if method in ['POST','PATCH','DELETE']:
            self.check_origin(env)
        if path=='/api/health' and method=='GET':
            db.execute('SELECT 1')
            return self.json(200,{'ok':True})
        if path=='/api/checkout/config' and method=='GET':
            available=bool(db.execute('SELECT 1 FROM users WHERE active=1').fetchone())
            return self.json(200,{'available':available,'consent_version':CONSENT_VERSION,'operator_name':self.config.operator_name,'test_mode':not self.config.production})
        if path=='/api/orders/receipt' and method=='GET':
            token=env.get('HTTP_IDEMPOTENCY_KEY','')
            if not re.fullmatch(r'[A-Za-z0-9_-]{20,100}',token):
                raise ApiError(404,'Сохранённый заказ не найден.')
            row=db.execute('SELECT id,number,total_cents FROM orders WHERE idempotency_hash=?',(digest(token),)).fetchone()
            if not row:
                raise ApiError(404,'Сохранённый заказ не найден.')
            items=[{'key':p['product_key'],'quantity':p['quantity']} for p in db.execute('SELECT product_key,quantity FROM order_items WHERE order_id=?',(row['id'],))]
            return self.json(200,{'number':row['number'],'total_cents':row['total_cents'],'items':items,'saved':True})
        if path=='/api/orders' and method=='POST':
            if not db.execute('SELECT 1 FROM users WHERE active=1').fetchone():
                raise ApiError(503,'Приём заказов временно недоступен. Корзина сохранена — свяжитесь с менеджером.')
            return self.create_order(env,self.read_json(env),db)
        if path=='/api/admin/login' and method=='POST':
            body=self.read_json(env)
            login=self.text(body.get('login',''),'Логин',60,1)
            password=body.get('password','')
            if not isinstance(password,str) or not 1<=len(password)<=256:
                raise ApiError(400,'Введите пароль.')
            # Persist attempts even when authentication is rejected.
            try:
                self.store.limit(db,'login-ip',self.client_ip(env),30,900)
                self.store.limit(db,'login-name',login.lower(),12,900)
            finally:
                db.commit()
            user=db.execute('SELECT * FROM users WHERE login=? COLLATE NOCASE AND active=1',(login,)).fetchone()
            valid=verify_password(password,user['password_hash'] if user else self.dummy_hash)
            if not user or not valid:
                raise ApiError(401,'Неверный логин или пароль.')
            token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires_at<?',(int(time.time()),))
            db.execute('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)',(digest(token),user['id'],csrf,int(time.time())+28800))
            db.commit()
            return self.json(200,{'user':{'id':user['id'],'name':user['name']},'csrf':csrf},[self.cookie(token)])
        if not path.startswith('/api/admin/'):
            raise ApiError(404,'Адрес не найден.')
        session=self.session(env,db)
        if method!='GET' and not hmac.compare_digest(env.get('HTTP_X_CSRF_TOKEN',''),session['csrf']):
            raise ApiError(403,'Обновите страницу кабинета и повторите действие.')
        if path=='/api/admin/me' and method=='GET':
            return self.json(200,{'user':{'id':session['user_id'],'name':session['name']},'csrf':session['csrf'],'statuses':STATUSES,'mail_enabled':self.config.mail_enabled,'test_mode':not self.config.production,'users':[dict(x) for x in db.execute('SELECT id,name FROM users WHERE active=1 ORDER BY name')]})
        if path=='/api/admin/logout' and method=='POST':
            db.execute('DELETE FROM sessions WHERE token_hash=?',(session['token_hash'],));db.commit()
            return self.json(200,{'ok':True},[self.cookie(expire=True)])
        if path=='/api/admin/orders' and method=='GET':
            query=parse_qs(env.get('QUERY_STRING',''))
            status=query.get('status',[''])[0]
            if status and status not in STATUSES:
                raise ApiError(400,'Неизвестный статус.')
            search=query.get('q',[''])[0][:100].strip()
            try:
                page=min(1000000,max(1,int(query.get('page',['1'])[0])))
            except ValueError:
                raise ApiError(400,'Некорректная страница.')
            filters=[];values=[]
            if status:
                filters.append('o.status=?');values.append(status)
            if search:
                search=search.casefold().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
                filters.append("(CASEFOLD(o.number) LIKE ? ESCAPE '\\' OR CASEFOLD(o.customer_name) LIKE ? ESCAPE '\\' OR CASEFOLD(o.phone) LIKE ? ESCAPE '\\' OR CASEFOLD(o.city) LIKE ? ESCAPE '\\')")
                values += ['%'+search+'%']*4
            where=' WHERE '+' AND '.join(filters) if filters else ''
            total=db.execute('SELECT COUNT(*) FROM orders o'+where,values).fetchone()[0]
            rows=db.execute('SELECT o.id,o.number,o.created_at,o.customer_name,o.phone,o.city,o.total_cents,o.status,o.next_contact_at,u.name AS assignee_name,b.state AS email_status FROM orders o LEFT JOIN users u ON u.id=o.assignee_id LEFT JOIN outbox b ON b.order_id=o.id'+where+' ORDER BY o.id DESC LIMIT 30 OFFSET ?',[*values,(page-1)*30])
            counts={s:0 for s in STATUSES}
            counts.update({x['status']:x['n'] for x in db.execute('SELECT status,COUNT(*) AS n FROM orders GROUP BY status')})
            return self.json(200,{'orders':[dict(x) for x in rows],'total':total,'page':page,'counts':counts})
        match=re.fullmatch(r'/api/admin/orders/([1-9][0-9]*)',path)
        if match:
            order_id=int(match[1])
            if method=='GET':
                return self.json(200,self.order_detail(db,order_id))
            if method=='PATCH':
                body=self.read_json(env)
                status=body.get('status');assignee=body.get('assignee_id')
                note=self.text(body.get('note',''),'Комментарий менеджера',3000)
                if not isinstance(status,str) or status not in STATUSES:
                    raise ApiError(400,'Выберите статус заказа.')
                if assignee is not None and (type(assignee) is not int or not db.execute('SELECT 1 FROM users WHERE id=? AND active=1',(assignee,)).fetchone()):
                    raise ApiError(400,'Выберите действующего менеджера.')
                callback=body.get('next_contact_at') or None
                if callback:
                    try:
                        callback=datetime.fromisoformat(callback.replace('Z','+00:00'))
                        if not callback.tzinfo:
                            raise ValueError()
                        callback=callback.astimezone(timezone.utc).isoformat(timespec='seconds')
                    except (ValueError,AttributeError):
                        raise ApiError(400,'Укажите корректную дату следующего звонка.')
                if type(body.get('version')) is not int:
                    raise ApiError(400,'Обновите карточку заказа.')
                db.execute('BEGIN IMMEDIATE')
                existing=db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
                if not existing:
                    raise ApiError(404,'Заказ не найден.')
                if existing['version']!=body['version']:
                    raise ApiError(409,'Другой менеджер уже изменил заказ. Обновите карточку; ваш комментарий пока не сохранён.')
                now=utcnow()
                db.execute('UPDATE orders SET status=?,assignee_id=?,next_contact_at=?,updated_at=?,version=version+1 WHERE id=?',(status,assignee,callback,now,order_id))
                changes=[]
                if existing['status']!=status:
                    changes.append(STATUSES[existing['status']]+' → '+STATUSES[status])
                if existing['assignee_id']!=assignee:
                    name=db.execute('SELECT name FROM users WHERE id=?',(assignee,)).fetchone() if assignee else None
                    changes.append('Ответственный: '+(name[0] if name else 'не назначен'))
                if existing['next_contact_at']!=callback:
                    changes.append('Следующий звонок: '+(callback or 'не назначен'))
                if note:
                    changes.append(note)
                db.execute('INSERT INTO history(order_id,created_at,actor,event,note) VALUES(?,?,?,?,?)',(order_id,now,session['name'],'updated','\n'.join(changes) or 'Карточка просмотрена и сохранена'))
                db.commit()
                return self.json(200,self.order_detail(db,order_id))
        raise ApiError(404,'Адрес не найден.')

    def privacy(self):
        name=html.escape(self.config.operator_name);email=html.escape(self.config.operator_email)
        body=f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Обработка данных заказа — Юрмани</title><link rel="stylesheet" href="/orders.css"></head><body><main class="policy wrap"><a href="/checkout.html">← К оформлению</a><h1>Обработка данных заказа</h1><p>Оператор: {name}. Контакт по вопросам заказа и обработки данных: <a href="mailto:{email}">{email}</a>.</p><p>Для обработки заказа вы передаёте имя, телефон, город, способ получения и, при доставке, адрес. Мы также сохраняем состав заказа, комментарий, время согласия и источник перехода на сайт, если он известен.</p><p>Данные используются для связи с вами, уточнения ассортимента, цены и условий получения, а также обработки заказа. Они доступны уполномоченным менеджерам. Данные заказа хранятся в базе приложения; уведомление может быть направлено на служебную почту менеджера.</p><p>Заявка не означает подтверждения наличия, итоговой стоимости или оплаты. За рекламными рассылками нужно отдельное согласие: эта форма на них не подписывает.</p><p>По вопросам уточнения, удаления данных или отзыва согласия свяжитесь с оператором по указанной почте.</p><p>Версия согласия: {CONSENT_VERSION}.</p></main></body></html>'''
        return 200,[('Content-Type','text/html; charset=utf-8'),('Cache-Control','no-store')],body.encode()

    def static(self,path,method):
        if method not in ['GET','HEAD']:
            raise ApiError(405,'Метод недоступен.')
        decoded=unquote(path)
        parts=Path(decoded.lstrip('/')).parts
        if any(p.startswith('.') or p=='..' for p in parts) or any(p in ['server','tools','tests','preview-dist'] for p in parts):
            raise ApiError(404,'Страница не найдена.')
        relative=decoded.lstrip('/') or 'index.html'
        if relative=='manager':
            return 302,[('Location','/manager/')],b''
        if relative.endswith('/'):
            relative+='index.html'
        file=(self.config.root/relative).resolve()
        allowed={'.html','.css','.js','.json','.xml','.txt','.pdf','.svg','.png','.jpg','.jpeg','.webp','.ico','.webmanifest'}
        if self.config.root.resolve() not in file.parents or file.suffix.lower() not in allowed or not file.is_file():
            error=self.config.root/'404.html'
            return 404,[('Content-Type','text/html; charset=utf-8')],error.read_bytes()
        ctype=mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        if file.suffix in ['.html','.css','.js','.json','.xml','.txt']:
            ctype+='; charset=utf-8'
        headers=[('Content-Type',ctype),('Cache-Control','no-store' if relative.startswith('manager/') or file.suffix=='.html' else 'public,max-age=300')]
        if relative.startswith('manager/') or relative=='checkout.html':
            headers.append(('X-Robots-Tag','noindex, nofollow'))
        return 200,headers,file.read_bytes()

    def __call__(self,env,start_response):
        path=env.get('PATH_INFO','/');method=env.get('REQUEST_METHOD','GET')
        try:
            if path.startswith('/api/'):
                with closing(self.store.connect()) as db:
                    try:
                        status,headers,body=self.api(env,path,method,db)
                    except ApiError:
                        # Committing rate-limit counters never commits a partial order.
                        db.rollback()
                        raise
            elif path=='/privacy.html':
                status,headers,body=self.privacy()
            else:
                status,headers,body=self.static(path,method)
        except ApiError as exc:
            status,headers,body=self.json(exc.status,{'error':exc.message,**exc.details})
        except Exception:
            # Do not disclose customer payloads, credentials, SQL or traces to clients/logs.
            status,headers,body=self.json(500,{'error':'Сервис временно недоступен. Данные формы сохранены на экране — попробуйте ещё раз.'})
        headers += [('X-Content-Type-Options','nosniff'),('Referrer-Policy','strict-origin-when-cross-origin'),('X-Frame-Options','DENY')]
        if path.startswith('/api/') or path.startswith('/manager'):
            headers.append(('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"))
        headers.append(('Content-Length',str(len(body))))
        start_response(str(status)+' '+HTTPStatus(status).phrase,headers)
        return [b'' if method=='HEAD' else body]


def create_app():
    return Application(Config.from_env())
