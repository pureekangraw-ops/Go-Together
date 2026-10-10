# GO-Together — GO Personal Brain

GO reasons, verifies, decides, and chooses what to remember. Intake is a deterministic tool: **search, retrieve, organize, edit, and provide source extracts for summarization**. It does not think independently, invent fields, or silently change records.

## Production

- Worker: https://go-together.pureekangraw.workers.dev
- MCP endpoint: https://go-together.pureekangraw.workers.dev/mcp
- D1 database: go-together, bound as `DB`.
- Owner browser sign-in: `/auth/login`, protected by an owner-only Cloudflare Access application on `/auth/*`. The owner must sign in to use the UI.
- ChatGPT OAuth: MCP protected resource metadata, OAuth authorization-server metadata, PKCE S256 authorization code/refresh token, ChatGPT client ID metadata document checks. ChatGPT owner connection requires explicit user authorization.
- `GET /api/health` is public and only checks D1 connectivity. No memory data is exposed publicly.
- Personal data API and `/mcp` reject anonymous requests. Bearer tokens are stored as SHA-256 hashes in D1.
- Archive/delete retains a revisioned audit trail. Concurrent writes require `expected_revision`; history uses database triggers.
- Retrieval is **lexical**, including Thai character n-grams. Summaries are evidence-linked excerpts, not a separately reasoning AI.

## Owner API

`GET /api/memories`, `GET /api/retrieve?q=...`, `GET /api/summarize?q=...`, `GET /api/memories/{id}`, `GET /api/memories/{id}/history`, `POST /api/memories`, `PATCH /api/memories/{id}`, `POST /api/memories/{id}/status`, `DELETE /api/memories/{id}`, `POST /api/memories/{id}/restore`.

MCP tools: `brain_search`, `brain_retrieve`, `brain_list`, `brain_save`, `brain_edit`, `brain_set_status`, `brain_history`, and `brain_summarize`.

## Storage & safety

`schema.sql` captures owned D1 tables, indexes, and audit triggers. Never connect the `picxie` database here. No WorkID is issued by this service; optional `work_id` is a pointer to the original Work System record.

### Tests

`node --test tests/worker.test.mjs`. The earlier Python `server.py` and `tests/test_server.py` remain a **local-only legacy prototype**, not used by Cloudflare Worker deployments.

Do not change Cloudflare Access to allow everyone. Do not enable public memory APIs. Protect owner information and use D1 backups before major migrations.
