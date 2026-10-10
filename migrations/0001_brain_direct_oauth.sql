CREATE TABLE IF NOT EXISTS brain_oauth_used(key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS brain_oauth_failures(key TEXT NOT NULL,attempted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS brain_oauth_failure_key ON brain_oauth_failures(key,attempted_at);
CREATE TABLE IF NOT EXISTS brain_oauth_revoked(family_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
