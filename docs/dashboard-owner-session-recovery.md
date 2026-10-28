# Dashboard owner session recovery

The dashboard previously told owners to use a login link that did not exist. Its API client also tried to parse every response as JSON, so Cloudflare Access login HTML and redirects appeared as JSON parser failures.

The visible Owner Login link uses the existing `/auth/login` route. The Hub link points to the established Hub Worker. Thai status messages identify expired/denied owner access, Access redirects, non-JSON responses, malformed JSON, and network failures. A separate reload button refreshes memory and approval lists after sign-in. Login remains an ordinary navigation so Access controls the authentication flow.

API calls include same-origin session cookies, use manual redirect handling, and bypass the browser HTTP cache. The network-only service worker also bypasses HTTP cache; service worker updates bypass the script cache. No private response, bearer token, passcode, approval, or retry queue is saved in browser storage. This does not change Access policy, JWT verification, OAuth, or backend authorization.

Approval payload/hash review and explicit owner clicks remain required. UNKNOWN jobs expose only status checks. If an approval or rejection response is ambiguous, this page locks that request against another click and offers status checks only. This conservative lock lasts for the current page lifetime; backend status/idempotency remains authoritative after reload. No mutation is retried by the client.

Local checks: `node --test --test-isolation=none tests/dashboard-session-recovery.test.mjs tests/pwa-static.test.mjs`. These cover actual extracted client functions with fake responses; they do not sign in to Cloudflare, approve cloud jobs, or prove deployed browser behavior. Production still requires the owner to complete Access login and read back session/API behavior after release.
