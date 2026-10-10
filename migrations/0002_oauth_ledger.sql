CREATE TABLE IF NOT EXISTS oauth_ledger (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS oauth_ledger_expiry ON oauth_ledger(expires_at);
