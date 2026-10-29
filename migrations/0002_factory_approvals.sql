CREATE TABLE IF NOT EXISTS factory_approvals (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL CHECK(domain IN ('CODE','VISUAL','LOGIC','PROOF')),
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  status TEXT NOT NULL CHECK(status IN ('PENDING','DISPATCHING','RUNNING','COMPLETED','FAILED','FAILED_NO_EXECUTION','UNKNOWN','REJECTED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  approved_payload_sha256 TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  result_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_factory_approvals_status_created ON factory_approvals(status,created_at);
CREATE TABLE IF NOT EXISTS factory_approval_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  event_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(approval_id) REFERENCES factory_approvals(id)
);
CREATE INDEX IF NOT EXISTS idx_factory_approval_events_approval ON factory_approval_events(approval_id,event_at);
CREATE TRIGGER IF NOT EXISTS factory_approvals_ai AFTER INSERT ON factory_approvals BEGIN
  INSERT INTO factory_approval_events(approval_id,action,actor,payload_sha256,event_at,details_json)
  VALUES(new.id,'PROPOSED',new.created_by,new.payload_sha256,new.created_at,
    json_object('requestId',new.request_id,'domain',new.domain,'status',new.status));
END;
CREATE TRIGGER IF NOT EXISTS factory_approvals_status_event AFTER UPDATE OF status ON factory_approvals
WHEN old.status<>new.status BEGIN
  INSERT INTO factory_approval_events(approval_id,action,actor,payload_sha256,event_at,details_json)
  VALUES(new.id,new.status,COALESCE(new.approved_by,new.rejected_by,new.created_by),new.payload_sha256,new.updated_at,
    json_object('previousStatus',old.status,'requestId',new.request_id,
      'approvedPayloadSha256',new.approved_payload_sha256,'rejectedAt',new.rejected_at));
END;
