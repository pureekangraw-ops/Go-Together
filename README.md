# GO-Together — GO Personal Brain

GO reasons, verifies, decides, and chooses what to remember. Intake is a deterministic tool: **search, retrieve, organize, edit, and provide source extracts for summarization**. It does not think independently, invent fields, or silently change records.

## Production — GO Brain direct OAuth

- Worker/web UI: https://go-together.pureekangraw.workers.dev
- MCP: https://go-together.pureekangraw.workers.dev/mcp
- Data: existing dedicated D1 `go-together` (`DB`); memories/history are unchanged.
- MCP uses the same OAuth protocol implementation as Metropolis: ChatGPT CIMD, S256 PKCE, owner passcode, isolated resource-bound access tokens and rotating refresh tokens with replay revocation. GO Brain uses only its own existing `BRAIN_OAUTH_SIGNING_KEY` and `BRAIN_OWNER_PASSCODE`; Metro tokens/keys are not reused.
- The fixed identity is BIG authorizing GO, with `brain-owner` scope. No separate Work lifecycle is introduced.
- MCP initialize/discovery/catalog are public; memory operations require the verified Brain bearer token. Anonymous catalog access reveals schemas only.
- `BRAIN_AUTH_MODE=DIRECT` selects native MCP authentication. Existing Cloudflare Access is retained only for web-owner `/auth/*` and `/api/*`; its Worker-wide MCP destination must be removed after the native handler deploys. No new Access application is needed.
- Health reports the deployed source SHA. Code tests and public OAuth discovery do not prove ChatGPT owner acceptance; the final live test is login → brain_list → synthetic save/retrieve/soft-delete → refresh.

### ChatGPT connection

Use the existing GO Brain app with MCP URL `https://go-together.pureekangraw.workers.dev/mcp`. Refresh its schema/connection after deployment, select OAuth or no authentication, and use CIMD without manually entering a Client ID or Client Secret. The server prompts for GO Brain's owner passcode once, then refreshes the connection through rotating refresh tokens.

### Migration

Apply `migrations/0001_brain_direct_oauth.sql` before deploying. It adds only replay/rate-limit ledger tables and does not alter memory records, history, or the legacy auth tables.

## Owner API

`GET /api/memories`, `GET /api/retrieve?q=...`, `GET /api/summarize?q=...`, `GET /api/memories/{id}`, `GET /api/memories/{id}/history`, `POST /api/memories`, `PATCH /api/memories/{id}`, `POST /api/memories/{id}/status`, `DELETE /api/memories/{id}`, `POST /api/memories/{id}/restore`.

MCP tools: `brain_search`, `brain_retrieve`, `brain_list`, `brain_save`, `brain_edit`, `brain_set_status`, `brain_history`, and `brain_summarize`.

## Factory owner approval

Factory jobs are staged as immutable proposals and run only after an owner click in the GO dashboard. See [the approval workflow](docs/factory-owner-approval-flow.md) for audit, notification, and rollout boundaries.

### Install GO on a phone

The owner dashboard is an installable web app (PWA), not an App Store/Play Store package. On iPhone/iPad, open the dashboard in Safari, sign in through Cloudflare Access, then use **Share → Add to Home Screen**. On Android, open it in Chrome, sign in, then choose **Install app** (or **Add to Home screen**) from the browser menu. Once installed, Factory approval status refreshes while the app is open and the owner can review, approve, reject, or check status there.

The phone needs internet and owner authentication. The app does not cache private data, queue approvals offline, or send push notifications.

## Storage & safety

`schema.sql` captures owned D1 tables, indexes, and audit triggers. Never connect the `picxie` database here. No WorkID is issued by this service; optional `work_id` is a pointer to the original Work System record.

### Tests

`node --test tests/worker.test.mjs`. The earlier Python `server.py` and `tests/test_server.py` remain a **local-only legacy prototype**, not used by Cloudflare Worker deployments.

Do not change Cloudflare Access to allow everyone. Do not enable public memory APIs. Protect owner information and use D1 backups before major migrations.
