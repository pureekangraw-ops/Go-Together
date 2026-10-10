# GO-Together — GO Personal Brain

GO reasons, verifies, decides, and chooses what to remember. Intake is a deterministic tool: **search, retrieve, organize, edit, and provide source extracts for summarization**. It does not think independently, invent fields, or silently change records.

## Production — single owner identity

- Worker and web UI: https://go-together.pureekangraw.workers.dev
- MCP: https://go-together.pureekangraw.workers.dev/mcp
- Data: dedicated Cloudflare D1 database `go-together` (`DB`); never modify `picxie`.
- Identity is verified **once** by Cloudflare Access for the entire `go-together` Worker. Allowed owner email is pinned in Access policy and `OWNER_EMAIL` config. The Worker checks only Access's verified identity (audience + owner email) before running GO's request.
- The intended OAuth provider is **Cloudflare Access Managed OAuth**. ChatGPT's existing GO-Together private plugin uses DCR and no additional per-tool permission scopes. No homegrown OAuth issuer, local tokens, per-tool reapproval, or GO-specific login account.
- Manual web UI and MCP both reach the same Intake operations after owner identity succeeds. Intake validates inputs, revisions, evidence, and database integrity; it does not authorize or judge GO.
- Archive/delete preserves revision history; concurrent writes use `expected_revision` and database audit triggers. Retrieval is lexical, including Thai n-grams; snippets are not independent AI conclusions.
- **Deployment acceptance remains pending until Cloudflare Access protects the whole Worker with Managed OAuth and ChatGPT finishes interactive owner login.** A successful Wrangler deployment by itself does not establish OAuth functionality.

### Required Cloudflare Access configuration

Edit the existing **GO-Together Owner Login** Access application; **replace** its former `/auth` public-path destination with the `go-together` Worker destination (production traffic). Keep the owner-email-only policy, and enable **Managed OAuth** with DCR limited to ChatGPT callback URLs. Do not create an extra Access application or bypass policy. After the edge configuration is saved, verify an unauthenticated `/mcp` request receives the Access OAuth challenge, then complete ChatGPT login and run `brain_list` and a safe create/readback/delete test.

## Owner API

`GET /api/memories`, `GET /api/retrieve?q=...`, `GET /api/summarize?q=...`, `GET /api/memories/{id}`, `GET /api/memories/{id}/history`, `POST /api/memories`, `PATCH /api/memories/{id}`, `POST /api/memories/{id}/status`, `DELETE /api/memories/{id}`, `POST /api/memories/{id}/restore`.

MCP tools: `brain_search`, `brain_retrieve`, `brain_list`, `brain_save`, `brain_edit`, `brain_set_status`, `brain_history`, and `brain_summarize`.

## Storage & safety

`schema.sql` captures owned D1 tables, indexes, and audit triggers. Never connect the `picxie` database here. No WorkID is issued by this service; optional `work_id` is a pointer to the original Work System record.

### Tests

`node --test tests/worker.test.mjs`. The earlier Python `server.py` and `tests/test_server.py` remain a **local-only legacy prototype**, not used by Cloudflare Worker deployments.

Do not change Cloudflare Access to allow everyone. Do not enable public memory APIs. Protect owner information and use D1 backups before major migrations.
