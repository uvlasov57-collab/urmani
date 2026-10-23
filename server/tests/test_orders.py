import copy
import io
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest
from server.app import Application, Config, CONSENT_VERSION
from server.mailer import send_pending

ROOT=Path(__file__).resolve().parents[2]

class OrdersTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.config=Config(ROOT,Path(self.temp.name),origin='https://example.test')
        self.app=Application(self.config)
        self.app.store.create_user('manager','Менеджер','only-test-password-123')
        self.key=next(iter(self.app.store.products))
        self.payload={'customer':{'name':'Тестовый клиент','phone':'+79510000001','city':'Аксай','address':'Тестовая улица, 1'},'fulfillment':'delivery','comment':'Тест','items':[{'key':self.key,'quantity':2}],'expected_total_cents':self.app.store.products[self.key]['price_cents']*2,'consent':True,'consent_version':CONSENT_VERSION}
        self.token='test-idempotency-token-123456'
    def tearDown(self):self.temp.cleanup()
    def call(self,path,method='GET',body=None,headers=None,app=None):
        path,_,query=path.partition('?')
        data=json.dumps(body).encode() if body is not None else b''
        env={'PATH_INFO':path,'QUERY_STRING':query,'REQUEST_METHOD':method,'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(data)),'wsgi.input':io.BytesIO(data),'REMOTE_ADDR':'127.0.0.1','HTTP_ORIGIN':self.config.origin}
        for k,v in (headers or {}).items():env['HTTP_'+k.upper().replace('-','_')]=v
        result=[]
        raw=b''.join((app or self.app)(env,lambda s,h:result.extend([int(s.split()[0]),dict(h)])))
        value=json.loads(raw) if result[1].get('Content-Type','').startswith('application/json') else raw
        return result[0],value,result[1]
    def order(self,payload=None,token=None):return self.call('/api/orders','POST',payload or self.payload,{'Idempotency-Key':token or self.token})
    def login(self):
        status,data,h=self.call('/api/admin/login','POST',{'login':'manager','password':'only-test-password-123'})
        self.assertEqual(status,200)
        self.assertIn('HttpOnly',h['Set-Cookie']);self.assertIn('Secure',h['Set-Cookie'])
        return {'Cookie':h['Set-Cookie'].split(';')[0],'X-CSRF-Token':data['csrf']}
    def count(self,table):
        with self.app.store.connect() as db:return db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
    def test_atomic_order_and_idempotency_after_restart(self):
        status,value,_=self.order();self.assertEqual(status,201);self.assertTrue(value['saved'])
        second=self.order();self.assertEqual(second[0],200);self.assertEqual(second[1],value)
        self.assertEqual(self.count('orders'),1);self.assertEqual(self.count('order_items'),1);self.assertEqual(self.count('outbox'),1)
        changed=copy.deepcopy(self.payload);changed['comment']='Иной заказ'
        self.assertEqual(self.order(changed)[0],409);self.assertEqual(self.count('orders'),1)
        restarted=Application(self.config)
        receipt=self.call('/api/orders/receipt',headers={'Idempotency-Key':self.token},app=restarted)
        self.assertEqual(receipt[1]['number'],value['number']);self.assertNotIn('phone',receipt[1])
    def test_concurrent_retries_create_one_order(self):
        with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:self.order(),range(4)))
        self.assertEqual(sorted(x[0] for x in results),[200,200,200,201]);self.assertEqual(self.count('orders'),1)
    def test_rejects_invalid_and_changed_price(self):
        for field,value in [('consent',False),('items',[{'key':self.key,'quantity':True}]),('items',[{'key':self.key,'quantity':0}]),('items',[{'key':'unknown','quantity':1}]),('expected_total_cents',1)]:
            body=copy.deepcopy(self.payload);body[field]=value
            self.assertIn(self.order(body)[0],[400,409])
        self.assertEqual(self.count('orders'),0);self.assertEqual(self.count('outbox'),0)
        fake=copy.deepcopy(self.payload);fake['items'][0]['price_cents']=1
        self.assertEqual(self.order(fake)[1]['total_cents'],self.payload['expected_total_cents'])
    def test_authorization_csrf_and_history(self):
        self.order();self.assertEqual(self.call('/api/admin/orders')[0],401)
        auth=self.login()
        rows=self.call('/api/admin/orders',headers=auth);self.assertEqual(rows[1]['total'],1)
        detail=self.call('/api/admin/orders/1',headers=auth)[1]
        body={'status':'contacted','assignee_id':1,'version':detail['version'],'note':'Позвонить завтра','next_contact_at':'2026-10-24T09:00:00+03:00'}
        self.assertEqual(self.call('/api/admin/orders/1','PATCH',body,{'Cookie':auth['Cookie']})[0],403)
        status,updated,_=self.call('/api/admin/orders/1','PATCH',body,auth)
        self.assertEqual(status,200);self.assertEqual(updated['status'],'contacted');self.assertEqual(len(updated['history']),2)
        self.assertEqual(self.call('/api/admin/orders/1','PATCH',body,auth)[0],409)
        self.assertEqual(self.call('/api/admin/orders?status=contacted&q=7951',headers=auth)[1]['total'],1)
        self.assertEqual(self.call('/api/admin/orders?q=тестовый',headers=auth)[1]['total'],1)
        self.call('/api/admin/logout','POST',{},auth)
        self.assertEqual(self.call('/api/admin/me',headers=auth)[0],401)
    def test_origin_private_files_and_login_limit(self):
        self.assertEqual(self.call('/api/orders','POST',self.payload,{'Origin':'https://foreign.test','Idempotency-Key':self.token})[0],403)
        for path in ['/server/app.py','/.env','/../orders.sqlite3','/tools/build_seo.py']:
            self.assertEqual(self.call(path)[0],404)
        for _ in range(12):self.assertEqual(self.call('/api/admin/login','POST',{'login':'manager','password':'wrong'})[0],401)
        self.assertEqual(self.call('/api/admin/login','POST',{'login':'manager','password':'wrong'})[0],429)
    def test_email_failure_never_loses_order(self):
        self.order()
        config=replace(self.config,smtp_host='test.invalid',mail_from='test@example.test',mail_to='manager@example.test')
        def failure(message):raise ConnectionError('private SMTP detail')
        self.assertEqual(send_pending(config,transport=failure)['failed'],1);self.assertEqual(self.count('orders'),1)
        with self.app.store.connect() as db:
            row=db.execute('SELECT * FROM outbox').fetchone();self.assertEqual(row['last_error'],'ConnectionError')
            db.execute('UPDATE outbox SET next_attempt=0');db.commit()
        messages=[]
        self.assertEqual(send_pending(config,transport=messages.append)['sent'],1)
        self.assertEqual(len(messages),1);self.assertIn('/manager/#order=1',messages[0].get_content())
        self.assertEqual(send_pending(config,transport=messages.append)['sent'],0)
    def test_unconfigured_site_cannot_accept_orders(self):
        with self.app.store.connect() as db:db.execute('UPDATE users SET active=0');db.commit()
        self.assertFalse(self.call('/api/checkout/config')[1]['available'])
        self.assertEqual(self.order()[0],503)

if __name__=='__main__':unittest.main()
