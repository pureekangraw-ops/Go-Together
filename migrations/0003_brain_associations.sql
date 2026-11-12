-- Versioned derived index and durable per-revision association work; no source rewrites.
CREATE TABLE brain_association_runs(
 id TEXT PRIMARY KEY,memory_id TEXT NOT NULL,revision INTEGER NOT NULL,extractor_version TEXT NOT NULL DEFAULT 'association-v1',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','failed','superseded')),
 attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,model TEXT,result_json TEXT,last_error TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(memory_id,revision,extractor_version)
);
CREATE INDEX idx_brain_runs_work ON brain_association_runs(state,created_at);
CREATE TABLE brain_memory_terms(
 memory_id TEXT NOT NULL,revision INTEGER NOT NULL,run_id TEXT NOT NULL DEFAULT '',
 term TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL,entity_key TEXT NOT NULL DEFAULT '',
 provenance TEXT NOT NULL,evidence_json TEXT NOT NULL,
 PRIMARY KEY(memory_id,revision,run_id,term,kind,entity_key)
);
CREATE INDEX idx_brain_terms_term ON brain_memory_terms(term,memory_id,revision);
CREATE TABLE brain_memory_links(
 run_id TEXT NOT NULL,target_id TEXT NOT NULL,target_revision INTEGER NOT NULL,type TEXT NOT NULL,
 evidence_json TEXT NOT NULL,target_evidence_json TEXT NOT NULL,
 PRIMARY KEY(run_id,target_id,type)
);
CREATE INDEX idx_brain_links_target ON brain_memory_links(target_id,target_revision);
CREATE TRIGGER brain_index_ai AFTER INSERT ON memories BEGIN
 INSERT INTO brain_memory_terms(memory_id,revision,term,label,kind,provenance,evidence_json)
 SELECT new.id,new.revision,lower(trim(value)),trim(value),'keyword','GO_supplied',json_object('field','tags','quote',value)
 FROM json_each(new.tags) WHERE type='text' AND length(trim(value))>0 ON CONFLICT DO NOTHING;
 INSERT INTO brain_association_runs(id,memory_id,revision,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),new.id,new.revision,new.updated_at,new.updated_at WHERE new.status IN ('active','needs_review');
END;
CREATE TRIGGER brain_index_au AFTER UPDATE ON memories WHEN old.revision<>new.revision BEGIN
 UPDATE brain_association_runs SET state='superseded',lease_token=NULL,lease_until=NULL,updated_at=new.updated_at
 WHERE memory_id=new.id AND revision<>new.revision AND state<>'superseded';
 INSERT INTO brain_memory_terms(memory_id,revision,term,label,kind,provenance,evidence_json)
 SELECT new.id,new.revision,lower(trim(value)),trim(value),'keyword','GO_supplied',json_object('field','tags','quote',value)
 FROM json_each(new.tags) WHERE type='text' AND length(trim(value))>0 ON CONFLICT DO NOTHING;
 INSERT INTO brain_association_runs(id,memory_id,revision,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),new.id,new.revision,new.updated_at,new.updated_at WHERE new.status IN ('active','needs_review') ON CONFLICT DO NOTHING;
END;
-- Backfill only existing explicit tags. No automatic API jobs for historical memories.
INSERT INTO brain_memory_terms(memory_id,revision,term,label,kind,provenance,evidence_json)
SELECT m.id,m.revision,lower(trim(j.value)),trim(j.value),'keyword','GO_supplied',json_object('field','tags','quote',j.value)
FROM memories m,json_each(m.tags) j WHERE j.type='text' AND length(trim(j.value))>0 ON CONFLICT DO NOTHING;
