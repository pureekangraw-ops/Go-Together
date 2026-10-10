-- Go-Together owned schema only; Cloudflare internal tables intentionally excluded.
CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL);

CREATE TABLE auth_tokens(token_hash TEXT PRIMARY KEY,refresh_hash TEXT UNIQUE NOT NULL,client_id TEXT NOT NULL,resource TEXT NOT NULL,scope TEXT NOT NULL,expires_at TEXT NOT NULL,refresh_expires_at TEXT NOT NULL);

CREATE TABLE history(id TEXT PRIMARY KEY,memory_id TEXT NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL);

CREATE TABLE memories(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',work_id TEXT NOT NULL DEFAULT '',evidence_url TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL DEFAULT '',confidence TEXT NOT NULL DEFAULT 'unknown',tags TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);

CREATE TABLE oauth_codes(code_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,resource TEXT NOT NULL,code_challenge TEXT NOT NULL,scope TEXT NOT NULL,expires_at TEXT NOT NULL);

CREATE INDEX idx_history_memory ON history(memory_id,created_at);

CREATE INDEX idx_mem_kind ON memories(kind,updated_at);

CREATE INDEX idx_mem_status ON memories(status,updated_at);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO history(id,memory_id,action,before_json,after_json,created_at) VALUES(lower(hex(randomblob(16))),new.id,'created',NULL,json_object('id',new.id,'title',new.title,'content',new.content,'kind',new.kind,'status',new.status,'work_id',new.work_id,'evidence_url',new.evidence_url,'outcome',new.outcome,'confidence',new.confidence,'tags',json(new.tags),'revision',new.revision,'created_at',new.created_at,'updated_at',new.updated_at),new.updated_at); END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO history(id,memory_id,action,before_json,after_json,created_at) VALUES(lower(hex(randomblob(16))),new.id,CASE WHEN new.status='deleted' AND old.status<>'deleted' THEN 'deleted' WHEN old.status='deleted' AND new.status='active' THEN 'restored' WHEN new.status<>old.status THEN 'status_changed' ELSE 'updated' END,json_object('id',old.id,'title',old.title,'content',old.content,'kind',old.kind,'status',old.status,'work_id',old.work_id,'evidence_url',old.evidence_url,'outcome',old.outcome,'confidence',old.confidence,'tags',json(old.tags),'revision',old.revision,'created_at',old.created_at,'updated_at',old.updated_at),json_object('id',new.id,'title',new.title,'content',new.content,'kind',new.kind,'status',new.status,'work_id',new.work_id,'evidence_url',new.evidence_url,'outcome',new.outcome,'confidence',new.confidence,'tags',json(new.tags),'revision',new.revision,'created_at',new.created_at,'updated_at',new.updated_at),new.updated_at); END;
CREATE TABLE IF NOT EXISTS brain_oauth_used(key TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS brain_oauth_failures(key TEXT NOT NULL,attempted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS brain_oauth_failure_key ON brain_oauth_failures(key,attempted_at);
CREATE TABLE IF NOT EXISTS brain_oauth_revoked(family_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
