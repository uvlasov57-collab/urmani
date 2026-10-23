PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, customer_name TEXT NOT NULL,
 phone TEXT NOT NULL, city TEXT NOT NULL, fulfillment TEXT NOT NULL, address TEXT NOT NULL,
 comment TEXT NOT NULL, total_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new',
 assignee_id INTEGER REFERENCES users(id), next_contact_at TEXT,
 attribution TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
 product_key TEXT NOT NULL, name TEXT NOT NULL, image TEXT NOT NULL,
 quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL,
 UNIQUE(order_id,product_key)
);
CREATE TABLE IF NOT EXISTS history (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
 created_at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
 id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT '', sent_at TEXT
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders(status,created_at DESC);
CREATE INDEX IF NOT EXISTS history_order ON history(order_id,id);
PRAGMA user_version=1;
