# GO Brain Metro OAuth Implementation Plan

**Goal:** Replace the MCP Cloudflare login route with the working Metro CIMD/PKCE/refresh method through direct GitHub and Cloudflare access.
**Architecture:** Adapt the Metro OAuth module to a separate Brain issuer, owner identity and scope. Use existing Brain secrets and additive D1 replay tables; preserve memory/history and the web-owner Access application.
**Spec:** Migrate the existing GO Brain MCP endpoint to isolated, owner-authorized CIMD OAuth with PKCE and refresh-token rotation.
**Tech Stack:** Cloudflare Worker ES modules, D1, Node SQLite tests.

- [x] Compare live Metro discovery and complete OAuth implementation with Brain.
- [x] Add failing acceptance tests for native discovery, PKCE authorization, memory readback, refresh and replay protection.
- [x] Implement worker/mcp-oauth.mjs and worker/oauth-ledger.mjs, route MCP and OAuth metadata, preserve private memory authorization.
- [x] Run node --test tests/*.test.mjs.
- [ ] Apply additive migration, commit/push code, deploy with source SHA and existing bindings/secrets.
- [ ] Replace Worker-wide Access destination with existing web API/auth path protection; verify MCP public discovery and private-call rejection live.
- [ ] Refresh existing ChatGPT GO Brain connection; owner authorization and memory/refresh acceptance remain pending until tool results return.

Review focus: untrusted callbacks; issuer/resource isolation; code/refresh replay; unauthenticated data access; memory row preservation.
