# Notion connection to GO Brain

Use `https://go-together.pureekangraw.workers.dev/mcp` with OAuth.
Leave the optional OAuth Client ID and Client Secret empty.
Authorize on GO Brain's owner passcode page, then test a Brain search from Notion.

The `/hub-mcp/brain` URL is the existing internal AppTools/Hub route.
It is not the public OAuth endpoint to put into Notion.

The OAuth server accepts only the exact Notion CIMD client
`https://app.notion.com/oauth/mcp-client-metadata.json` and pins its callback to
`https://app.notion.com/workflows/mcp/oauth/callback`.
It retains PKCE S256, the owner passcode, resource-bound bearer tokens,
one-use authorization codes, and refresh rotation/replay revocation.

This compatibility change retains the existing BIG-delegates-GO identity and
`brain-owner` scope. It does not introduce separate LIGHT permissions or a
per-agent authorization model.

Verification: `node --test tests/worker.test.mjs tests/notion-oauth.test.mjs`.
The 14 Notion/compatibility tests fail on the original source for the expected
invalid-client reason and pass with this patch. The existing 13 Worker tests
also pass. Synthetic test credentials never use production secrets.

The running Worker contains unrelated source differences from repository main.
Rollout must preserve the exact live modules/configuration and replace only
`mcp-oauth.mjs`; do not deploy repository main wholesale. The rollback baseline
observed on 2026-10-29 was version `a0b58515-5eeb-49e2-ae59-124b628d481e`.

Final acceptance requires the owner to complete the Notion OAuth flow and make
a real Brain read from Notion. Unit tests and the authorization form alone do
not establish Notion end-to-end acceptance.
