#!/usr/bin/env python3
"""GO-Together Personal Brain — local-only prototype server."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("BRAIN_DB", ROOT / "data" / "personal_brain.sqlite3"))
STATIC = ROOT / "static"
ALLOWED_KINDS = {"core_identity", "operational_memory", "skill"}
ALLOWED_STATUSES = {"active", "needs_review", "stale", "archived", "deleted"}
FIELDS = ("kind", "title", "content", "status", "work_id", "evidence_url", "outcome", "confidence", "tags")
MAX_BODY = 1_000_000
DB_LOCK = threading.RLock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextmanager
def db_session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with DB_LOCK, db_session() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
          content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
          work_id TEXT NOT NULL DEFAULT '', evidence_url TEXT NOT NULL DEFAULT '',
          outcome TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT 'unknown',
          tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history (
          id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, action TEXT NOT NULL,
          before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
        CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
        CREATE INDEX IF NOT EXISTS idx_history_memory ON history(memory_id, created_at);
        """)


def row_to_dict(row: sqlite3.Row) -> dict:
    out = dict(row)
    out["tags"] = json.loads(out.get("tags") or "[]")
    return out


def record_event(db: sqlite3.Connection, memory_id: str, action: str, before, after) -> None:
    db.execute(
        "INSERT INTO history(id,memory_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?)",
        (str(uuid.uuid4()), memory_id, action,
         json.dumps(before, ensure_ascii=False) if before is not None else None,
         json.dumps(after, ensure_ascii=False) if after is not None else None, now()),
    )


def validate_payload(data: dict, partial: bool = False) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Request must be a JSON object")
    clean = {}
    for key in FIELDS:
        if key in data:
            clean[key] = data[key]
    if not partial or "kind" in clean:
        kind = clean.get("kind")
        if kind not in ALLOWED_KINDS:
            raise ValueError("kind must be core_identity, operational_memory, or skill")
    if not partial or "title" in clean:
        title = str(clean.get("title", "")).strip()
        if not title or len(title) > 200:
            raise ValueError("title is required and must be 200 characters or less")
        clean["title"] = title
    if not partial or "content" in clean:
        content = str(clean.get("content", "")).strip()
        if not content or len(content) > 50_000:
            raise ValueError("content is required and must be 50,000 characters or less")
        clean["content"] = content
    if "status" in clean and clean["status"] not in ALLOWED_STATUSES:
        raise ValueError("Invalid status")
    for key in ("work_id", "evidence_url", "outcome"):
        if key in clean:
            clean[key] = str(clean[key] or "").strip()
            if len(clean[key]) > (2000 if key == "evidence_url" else 1000):
                raise ValueError(f"{key} is too long")
    if "evidence_url" in clean and clean["evidence_url"]:
        if not re.match(r"^(https?://|notion://|user://)", clean["evidence_url"], re.I):
            raise ValueError("evidence_url must use http(s), notion://, or user://")
    if "confidence" in clean:
        clean["confidence"] = str(clean["confidence"] or "unknown").lower()
        if clean["confidence"] not in {"confirmed", "probable", "unknown"}:
            raise ValueError("confidence must be confirmed, probable, or unknown")
    if "tags" in clean:
        tags = clean["tags"]
        if isinstance(tags, str):
            tags = [x.strip() for x in tags.split(",") if x.strip()]
        if not isinstance(tags, list) or any(not isinstance(t, str) for t in tags):
            raise ValueError("tags must be a list of strings")
        clean["tags"] = json.dumps(list(dict.fromkeys(t.strip()[:40] for t in tags if t.strip()))[:20], ensure_ascii=False)
    return clean


def tokenize(text: str) -> list[str]:
    tokens = []
    for word in re.findall(r"[\w\u0E00-\u0E7F-]+", text.casefold()):
        if len(word) > 1:
            tokens.append(word)
        # Thai text is commonly written without spaces. Character n-grams
        # allow partial Thai queries to match without a tokenizer dependency.
        if any("\u0e00" <= c <= "\u0e7f" for c in word):
            for size in (2, 3, 4):
                tokens.extend(word[i:i + size] for i in range(max(0, len(word) - size + 1)))
    return tokens


class BrainHandler(BaseHTTPRequestHandler):
    server_version = "GO-TogetherBrain/0.1"

    def log_message(self, fmt, *args):
        # Keep local development output concise and do not log request bodies.
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid Content-Length")
        if length < 1 or length > MAX_BODY:
            raise ValueError("Request body must be between 1 byte and 1 MB")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as e:
            raise ValueError("Invalid JSON") from e

    def _static(self, name: str) -> None:
        path = (STATIC / name).resolve()
        if STATIC.resolve() not in path.parents or not path.is_file():
            self.send_error(404)
            return
        data = path.read_bytes()
        ctype = "text/html; charset=utf-8" if path.suffix == ".html" else "text/plain; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)
        if path == "/" or path == "/index.html":
            return self._static("index.html")
        if path == "/api/health":
            return self._json(200, {"ok": True, "app": "GO-Together Personal Brain", "version": "0.1.0", "storage": "local SQLite", "network": "loopback-only", "semantic_retrieval": False, "intake_mode": "explicit-operations-only", "autonomous_changes": False})
        if path == "/api/stats":
            with DB_LOCK, db_session() as db:
                rows = db.execute("SELECT status, COUNT(*) AS n FROM memories GROUP BY status").fetchall()
            stats = {s: 0 for s in ALLOWED_STATUSES}
            stats.update({r["status"]: r["n"] for r in rows})
            return self._json(200, stats)
        if path == "/api/memories":
            status = q.get("status", ["active"])[0]
            kind = q.get("kind", [""])[0]
            term = q.get("q", [""])[0].strip()
            clauses, params = [], []
            if status != "all":
                if status not in ALLOWED_STATUSES:
                    return self._json(400, {"error": "Invalid status filter"})
                clauses.append("status=?"); params.append(status)
            if kind:
                if kind not in ALLOWED_KINDS:
                    return self._json(400, {"error": "Invalid kind filter"})
                clauses.append("kind=?"); params.append(kind)
            if term:
                clauses.append("(title LIKE ? OR content LIKE ? OR work_id LIKE ? OR outcome LIKE ? OR tags LIKE ?)")
                like = f"%{term}%"; params.extend([like] * 5)
            sql = "SELECT * FROM memories" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY updated_at DESC LIMIT 500"
            with DB_LOCK, db_session() as db:
                items = [row_to_dict(r) for r in db.execute(sql, params).fetchall()]
            return self._json(200, {"items": items, "count": len(items)})
        if path == "/api/retrieve":
            query = q.get("q", [""])[0].strip()
            words = set(tokenize(query))
            if not words:
                return self._json(400, {"error": "Provide a non-empty q query"})
            with DB_LOCK, db_session() as db:
                items = [row_to_dict(r) for r in db.execute("SELECT * FROM memories WHERE status IN ('active','needs_review')").fetchall()]
            ranked = []
            for item in items:
                hay = " ".join([item["title"] * 3, item["content"], item["work_id"] * 2, item["outcome"], " ".join(item["tags"])]).casefold()
                tokens = set(tokenize(hay))
                overlap = words & tokens
                if overlap:
                    score = round(len(overlap) / max(1, len(words)), 3)
                    ranked.append({"score": score, "memory": item})
            ranked.sort(key=lambda x: (x["score"], x["memory"]["updated_at"]), reverse=True)
            return self._json(200, {"query": query, "method": "lexical-v1", "items": ranked[:25], "count": min(len(ranked), 25), "notice": "Lexical matching only; not semantic or model-based retrieval."})
        match = re.fullmatch(r"/api/memories/([^/]+)(?:/(history|restore))?", path)
        if match:
            memory_id, action = unquote(match.group(1)), match.group(2)
            with DB_LOCK, db_session() as db:
                if action == "history":
                    rows = db.execute("SELECT * FROM history WHERE memory_id=? ORDER BY created_at DESC", (memory_id,)).fetchall()
                    out = []
                    for row in rows:
                        e = dict(row)
                        e["before"] = json.loads(e.pop("before_json")) if e.get("before_json") else None
                        e["after"] = json.loads(e.pop("after_json")) if e.get("after_json") else None
                        out.append(e)
                    return self._json(200, {"items": out})
                row = db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
            if row is None:
                return self._json(404, {"error": "Memory not found"})
            return self._json(200, row_to_dict(row))
        return self._json(404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/memories":
            try:
                data = validate_payload(self._body())
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            data.setdefault("status", "active")
            data.setdefault("work_id", "")
            data.setdefault("evidence_url", "")
            data.setdefault("outcome", "")
            data.setdefault("confidence", "unknown")
            data.setdefault("tags", "[]")
            memory_id, stamp = str(uuid.uuid4()), now()
            with DB_LOCK, db_session() as db:
                db.execute("INSERT INTO memories(id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                           (memory_id, data["kind"], data["title"], data["content"], data["status"], data["work_id"], data["evidence_url"], data["outcome"], data["confidence"], data["tags"], stamp, stamp))
                after = row_to_dict(db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone())
                record_event(db, memory_id, "created", None, after)
            return self._json(201, after)
        m = re.fullmatch(r"/api/memories/([^/]+)/(restore|status)", parsed.path)
        if m:
            memory_id, action = unquote(m.group(1)), m.group(2)
            try:
                body = self._body()
                if action == "status":
                    status = body.get("status")
                    if status not in ALLOWED_STATUSES - {"deleted"}:
                        raise ValueError("Invalid status")
                else:
                    status = "active"
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            with DB_LOCK, db_session() as db:
                row = db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
                if row is None:
                    return self._json(404, {"error": "Memory not found"})
                before = row_to_dict(row)
                db.execute("UPDATE memories SET status=?,updated_at=? WHERE id=?", (status, now(), memory_id))
                after = row_to_dict(db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone())
                record_event(db, memory_id, "status_changed", before, after)
            return self._json(200, after)
        return self._json(404, {"error": "Not found"})

    def do_PATCH(self):
        match = re.fullmatch(r"/api/memories/([^/]+)", urlparse(self.path).path)
        if not match:
            return self._json(404, {"error": "Not found"})
        memory_id = unquote(match.group(1))
        try:
            data = validate_payload(self._body(), partial=True)
            if not data:
                raise ValueError("No editable fields provided")
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        with DB_LOCK, db_session() as db:
            row = db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
            if row is None:
                return self._json(404, {"error": "Memory not found"})
            before = row_to_dict(row)
            encoded = dict(data)
            if "tags" in encoded:
                encoded["tags"] = encoded["tags"]
            encoded["updated_at"] = now()
            set_sql = ",".join(f"{k}=?" for k in encoded)
            db.execute(f"UPDATE memories SET {set_sql} WHERE id=?", [*encoded.values(), memory_id])
            after = row_to_dict(db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone())
            record_event(db, memory_id, "updated", before, after)
        return self._json(200, after)

    def do_DELETE(self):
        match = re.fullmatch(r"/api/memories/([^/]+)", urlparse(self.path).path)
        if not match:
            return self._json(404, {"error": "Not found"})
        memory_id = unquote(match.group(1))
        with DB_LOCK, db_session() as db:
            row = db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
            if row is None:
                return self._json(404, {"error": "Memory not found"})
            before = row_to_dict(row)
            db.execute("UPDATE memories SET status='deleted',updated_at=? WHERE id=?", (now(), memory_id))
            after = row_to_dict(db.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone())
            record_event(db, memory_id, "deleted", before, after)
        return self._json(200, {"ok": True, "item": after, "note": "Soft-deleted; history retained. Restore is available."})

    def do_OPTIONS(self):
        # No CORS headers: API is intended for the same-origin local UI only.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()


def main() -> None:
    init_db()
    host = os.environ.get("BRAIN_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("Safety: this prototype only binds to loopback. External deployment requires authentication and review.")
    port = int(os.environ.get("BRAIN_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), BrainHandler)
    print(f"GO-Together Personal Brain prototype at http://{host}:{port}")
    print(f"SQLite data: {DB_PATH}")
    print("Loopback-only; do not expose to a network.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
