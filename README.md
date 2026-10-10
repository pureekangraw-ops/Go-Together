# GO-Together — Personal Brain prototype

A small local-only proof slice for collecting, searching, reviewing, updating, archiving, and restoring GO knowledge with WorkID/evidence links and an auditable change history.

## Run locally

```bash
python3 server.py
```

Open `http://127.0.0.1:8765`. Data is stored in `data/personal_brain.sqlite3` by default. Override with `BRAIN_DB` or `BRAIN_PORT` if needed.

## Verify

```bash
python3 -m unittest discover -s tests -v
```

## API

- `GET /api/health`
- `GET /api/memories?status=active&kind=operational_memory&q=...`
- `GET /api/retrieve?q=...` — lexical token matching only; not embeddings or semantic search
- `GET /api/memories/{id}/history`
- `POST /api/memories`
- `PATCH /api/memories/{id}`
- `POST /api/memories/{id}/status`
- `DELETE /api/memories/{id}` — soft delete; audit retained
- `POST /api/memories/{id}/restore`

## Role boundaries

- **GO** reasons, decides what matters, and owns learning or correction.
- **Intake** is a deterministic tool boundary: accept an explicit operation, validate its supplied fields, execute it, and return the result. It does not infer intent, invent missing fields, silently reclassify content, or decide to change a memory.
- **Personal Brain** stores and returns records, status, provenance, and change history.
- This prototype currently exposes typed API/UI operations only. It does not parse natural-language commands or generate summaries. Invalid or incomplete requests are rejected rather than guessed.
- Retrieval uses deterministic lexical matching and returns source-linked records; GO evaluates their meaning and fit.

## Prototype boundaries

- Binds to loopback only. Do not expose this server to a network.
- Single local SQLite store; no authentication, remote hosting, cloud sync, or cross-room agent connection yet.
- Local SQLite is not encrypted by the app; protect the host device and backups.
- Search is transparent lexical matching; no embeddings or model calls.
- No model fine-tuning or weight changes.
- No live Notion/WorkID verification: supplied links are stored as provenance pointers only.
- Before deployment, add owner authentication, encrypted backups, concurrency/version conflict handling, a tested agent-facing connector, and security review.
