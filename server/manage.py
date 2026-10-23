"""CLI: account setup, local preview, email outbox, consistent SQLite backups."""
from contextlib import closing
from dataclasses import replace
from getpass import getpass
from pathlib import Path
from socketserver import ThreadingMixIn
from wsgiref.simple_server import make_server, WSGIServer, WSGIRequestHandler
import argparse
import json
import os
import sqlite3
import threading
import time
import webbrowser

from .app import Application, Config, Store, password_hash
from .mailer import send_pending


def setup_account(store):
    login=input('Manager login (Latin letters, e.g. manager): ').strip()
    name=input('Manager display name: ').strip()
    if not name:
        raise ValueError('Manager name is required')
    password=getpass('Password (at least 12 characters): ')
    if password!=getpass('Repeat password: '):
        raise ValueError('Passwords do not match')
    store.create_user(login,name,password)
    print('Account created. Password is not stored in source files.')


class ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads=True


class QuietHandler(WSGIRequestHandler):
    def log_message(self,format,*args):
        # Do not record URLs/search terms containing customer details.
        pass


def main(argv=None):
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('create-user')
    reset=sub.add_parser('reset-password');reset.add_argument('login')
    disable=sub.add_parser('disable-user');disable.add_argument('login')
    backup=sub.add_parser('backup');backup.add_argument('destination')
    sub.add_parser('send-mail')
    sub.add_parser('mail-worker')
    serve=sub.add_parser('serve');serve.add_argument('--port',type=int,default=int(os.getenv('PORT','8000')));serve.add_argument('--host',default='127.0.0.1');serve.add_argument('--setup',action='store_true');serve.add_argument('--open',action='store_true')
    serve.add_argument('--strictPort',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args(argv)
    config=Config.from_env();store=Store(config)
    if args.command=='create-user':
        setup_account(store)
    elif args.command=='reset-password':
        password=getpass('New password (at least 12 characters): ')
        if password!=getpass('Repeat password: ') or not 12<=len(password)<=256:
            raise ValueError('Passwords must match and contain 12–256 characters')
        with closing(store.connect()) as db,db:
            user=db.execute('SELECT id FROM users WHERE login=?',(args.login,)).fetchone()
            if not user:
                raise ValueError('User not found')
            db.execute('UPDATE users SET password_hash=? WHERE id=?',(password_hash(password),user['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
        print('Password changed; previous sessions revoked.')
    elif args.command=='disable-user':
        with closing(store.connect()) as db,db:
            user=db.execute('SELECT id FROM users WHERE login=? AND active=1',(args.login,)).fetchone()
            if not user:
                raise ValueError('User not found')
            if db.execute('SELECT COUNT(*) FROM users WHERE active=1').fetchone()[0]<=1:
                raise ValueError('Cannot disable the last active manager')
            db.execute('UPDATE users SET active=0 WHERE id=?',(user['id'],));db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
        print('Account disabled and sessions revoked.')
    elif args.command=='backup':
        dest=Path(args.destination).resolve()
        if dest==config.root.resolve() or config.root.resolve() in dest.parents:
            raise ValueError('Save backups outside the site/repository directory')
        dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists():
            raise ValueError('Destination already exists. Choose a new backup filename.')
        with closing(store.connect()) as source,closing(sqlite3.connect(dest)) as target:
            source.backup(target)
        try:os.chmod(dest,0o600)
        except OSError:pass
        print('Backup saved.')
    elif args.command=='send-mail':
        print(json.dumps(send_pending(config)))
    elif args.command=='mail-worker':
        if not config.mail_enabled:
            raise ValueError('Configure SMTP and notification recipient before starting mail-worker')
        while True:
            send_pending(config)
            time.sleep(15)
    elif args.command=='serve':
        if config.production:
            raise ValueError('Use Waitress behind the HTTPS proxy in production; this command is local preview only')
        with closing(store.connect()) as db:
            empty=not db.execute('SELECT 1 FROM users WHERE active=1').fetchone()
        if args.setup and empty:
            print('First launch: create your manager account.')
            setup_account(store)
        origin=os.getenv('URMANI_ORIGIN',f'http://127.0.0.1:{args.port}').rstrip('/')
        config=replace(config,origin=origin)
        application=Application(config)
        server=make_server(args.host,args.port,application,server_class=ThreadedServer,handler_class=QuietHandler)
        print('URMANI order service — local preview, use test data only.')
        print('Site: '+origin+'/')
        print('Manager: '+origin+'/manager/')
        print('Keep this window open. Stop with Ctrl+C.')
        if args.open:
            timer=threading.Timer(.5,lambda:webbrowser.open(origin+'/'));timer.daemon=True;timer.start()
        try:server.serve_forever()
        except KeyboardInterrupt:print('Stopped.')


if __name__=='__main__':
    try:main()
    except (ValueError,sqlite3.IntegrityError) as exc:raise SystemExit(str(exc))
