# GO Brain Librarian — Link Health v1

## Purpose
Owner asked to retain source-of-truth documents in Google Drive/GitHub/Notion and store references in GO Brain. This adds a **bounded, on-demand, read-only HTTP reachability checker** for the existing `memories.evidence_url` field. It does not crawl external accounts, create a new database, or certify document access, revision, authenticity or content.

## Interfaces
- Owner-protected MCP: `brain_reference_check({id})` checks one existing memory record.
- Owner-protected MCP: `brain_reference_audit({limit?:1..5})` spot-checks up to five recently updated active memory records with references.
- Owner HTTP: `GET /api/references/check?id=<memory-uuid>` and `GET /api/references/audit?limit=3`.
- An unchanged link remains in the authoritative memory. Results are transient and do **not** overwrite `evidence_url`, tags, history or link content.

## Interpretation
| Status | Meaning |
| --- | --- |
| `HTTP_REACHABLE_NOT_CONTENT_VERIFIED` | The HTTPS server responded 2xx. It could be a sign-in page rather than the document. |
| `REDIRECT_NOT_VERIFIED` | A 3xx redirect was observed but not followed. The target document is not verified. |
| `AUTH_REQUIRED_OR_BLOCKED` | 401/403; do not mark link broken. |
| `NOT_FOUND_OR_PRIVATE` | 404; may be deleted or deliberately hidden from an unauthenticated caller. |
| `GONE_REPORTED` | HTTP 410 reported gone; still verify owner/provider permissions. |
| `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `NETWORK_UNVERIFIED` | Inconclusive external/service failure. |
| `NO_REFERENCE`, `INACTIVE_RECORD`, `RECORD_NOT_FOUND` | A record has no usable reference, is inactive, or cannot be found. |
| `UNSUPPORTED_OR_UNSAFE_URL`, `SENSITIVE_QUERY_NOT_PROBED` | Intentionally not fetched. Needs an authorized provider-native verification route. |

Every result has timestamp, memory ID and revision, host, HTTP status/method, check classification and explicit `content_verified:false`/`provider_authorization_verified:false`. **No document data or URL query is returned.**

## Safety boundaries
- Only URLs already stored in owner-authorized GO Brain can be probed.
- HTTPS only; no embedded credentials, nonstandard ports, IP addresses, localhost, arbitrary hosts, or obviously credential-bearing query parameters.
- Allowed host list for common owner documents: GitHub, GitLab, Google Drive/Docs/Colab, Notion, Figma and Slack workspace domains. All other sites return unsupported; no arbitrary URL fetch proxy.
- HEAD first. If the server explicitly does not support HEAD (405/501), one bounded GET with a 0–0 byte Range request. `redirect:manual`; no redirects followed, no cookies, no account tokens, no response body processed. Timeout 4 seconds per attempt.
- Maximum five URLs per owner-invoked audit and no automatic scans, scheduled jobs, secret changes, OAuth changes or database migrations.
- Private Drive/Notion/GitHub documents require an **authorized provider-native read** by GO after this HTTP signal. A public login page returning 200 never proves a private file exists.
- `brain_retrieve` singular record-return bug #32 is a separate issue; this checker deliberately returns a wrapped result and fetches only the reference fields.

## Zone 3 acceptance
1. Tests for 2xx/3xx/401/403/404/410/429/5xx and HEAD→GET fallback; no unsafe targets fetched.
2. Authenticated HTTP and MCP report consistent checks for existing records and explicit missing/no-reference cases.
3. Unauthorized HTTP caller rejected before D1 access, no data writes, no stored link mutation.
4. Deployment preserves Production GO provider catalog, all original bindings, OAuth, D1 and asset configuration. Review actual V51 rather than assuming GitHub main matches Production.
5. Live read-only check of one confirmed public GitHub reference and one private/protected or unsupported reference, without equating HTTP 200 with document access.

Current candidate is **a source/CI implementation only until Cloudflare and GO live-tool checks confirm otherwise**.
