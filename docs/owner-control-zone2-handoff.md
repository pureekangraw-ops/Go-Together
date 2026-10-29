# GO + Hub owner recovery — Zone 2 handoff

Owner follow-up: automatic schema updates are required. The existing Hub refresh mechanism runs at entry, on return/online, and every 60 seconds while the page is visible. It uses the existing 60-second source cache and never approves changed source versions or invokes Factory jobs.

## Delivered behavior

- GO has a persistent Owner Login link to the existing Access-protected `/auth/login`, same-origin credentialed reads, explicit session/HTML/network errors, network-only PWA fetches and no-store static headers. Ambiguous approval clicks are held for read-only status checks. Factory proposal/hash review and owner click remain mandatory.
- Existing Hub panel becomes a Thai mobile/desktop owner console: overview, searchable live catalog, CODE/VISUAL/LOGIC/PROOF, existing GO proposals and receipt reads, identity/permissions, actual delivery and approval-event history. Technical details are under Advanced. Missing actor/work/end-time/general GOVIEW status data stays explicitly unreported.
- GO's existing private `AppTools` gains bounded read-only `ownerStatus()`. Existing Hub Access validation protects `GET /api/owner/dashboard` before the snapshot is read. No public GO snapshot endpoint, new Worker, adapter, secret, queue, database or approval system is added. The existing Workers receive version metadata bindings so the UI can show their actual serving versions rather than a hardcoded version label.
- Partial source failures do not erase healthy status. Failed catalog refresh clears stale tools and disables calls. Schema failure still allows dashboard reads. Receipt transport state never implies Factory job success.

## Root cause and baseline

GO source referred users to a login link that did not exist; fetch handling assumed every response was JSON and hid Access redirects/session/network failures. The production Access application protects `/auth/*` and `/api/*` under the same audience; no authentication change is necessary.

GO V56 `45c62178-6991-4ed9-a35c-314eca1e98fa` was inspected via Cloudflare. All 15 runtime modules match repository source SHA-256. `HUB_V2 → HubBridge` is already correct. `OBSERVATORY_GO` and `GOVIEW_GO` still lack named entrypoints in the observed production metadata; their receivers independently export `ObservatoryGoBridge.invoke` and `GoviewGoBridge.invoke`. Source configuration already has the correct destinations and retains them.

Hub V21 `9f631634-e9dd-4682-bf10-ccafe3d79819` is based on `e4d7a9c1898f62858cde5bdb957fdc6c8612b111`, not GitLab main. A baseline rebuild matches the downloaded production bundle after normalization of generated dependency path comments and final newlines only. Normalized SHA-256: `b581f1fb8df40d5dd586796c15f2c8edfb48ac3461fdbafcf25eba527d64540c`. The Hub review branch is based on that deployed source; do not mix later unrelated provider changes into this recovery.

Production D1 SELECT confirmed proposal `187e2e08-52f6-4cf6-afec-5baa663446d1`, request `8e4a56a9-9144-4c40-a848-e8ae8830ae41`, VISUAL, PENDING. Rows written: zero. No production approval/job/secret/binding was changed.

## Evidence and limits

See `owner-control-production-baseline.json` and `owner-control-test-evidence.json`. GO local suite: 170 passed; Hub: 96 passed. Both Wrangler dry-run builds passed. Paired browser test runs real GO/Hub bundles, D1, signed JWT verification and named service RPC at 390px and 1440px; only the Access edge and Factory health are synthetic. It verifies PENDING preservation, UNKNOWN preservation, zero approval/job requests, catalog search, identity, no horizontal overflow, schema failure isolation and stale-catalog disabling. The old advanced catalog regression also passes at 390px after fixing unwrapped diagnostic codes; earlier 1440/768 stages passed. Security review findings were fixed and rechecked.

Screenshots and machine report are generated under Hub `test-results/`: `go-owner-{390,1440}.png`, `hub-overview-{390,1440}.png`, `hub-factory-{390,1440}.png`, `hub-tools-{390,1440}.png`, `owner-control-browser.json`. These are explicitly local synthetic-boundary evidence, not production screenshots. Reproduce with the paired source directories:

```sh
# Build both reviewed trees with their pinned Wrangler; use deploy --dry-run only.
node --test --test-isolation=none tests/*.test.mjs  # GO tree
node --test --test-isolation=none test/*.test.js   # Hub tree
GO_SOURCE_DIR=/path/to/reviewed/GO BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:owner-browser
```

Production assets/owner IdP flow cannot be claimed verified from a local test. The connected browser was unavailable. The main room/owner should verify the real mobile browser and installed PWA after the separately approved release. No new paid service, paid AI call, real Factory job or replay of UNKNOWN work was used. Existing CI may run once when review branches are created; no rerun is requested.

## Zone 3 deploy and rollback plan — not executed

1. Pin reviewed GO and Hub commits and save fresh active-version metadata plus complete current asset release/manifest. Compare with this baseline; reconcile any newer release before proceeding. Preserve all live secret and Secrets Store references without reading their values.
2. Review both runtime and static assets as one GO candidate. No new migration is required: the existing Factory approvals tables were verified by read. Do not replay, regenerate or approve the existing PENDING proposal.
3. Release the reviewed GO candidate first, retaining `DB`, assets routing, OAuth/Access variables, all secrets and four service destinations. Keep `HUB_V2 → HubBridge`; restore the source-declared Observatory/GOVIEW named entrypoints. Include actual Worker version metadata. Read back the exact deployed version and asset identifiers.
4. Release the reviewed Hub candidate from the V21 baseline, retaining `HUB_DB`, `GO_APPS → AppTools`, all seven Secrets Store bindings, existing secret names, provider mappings, managed connectors and Access policy. The added owner read uses the same private binding. Refresh schemas with the existing mechanism; changed schemas remain owner-review-required.
5. Verify authenticated real mobile/desktop login, private memory, original PENDING proposal, Factory health/readback, all five status cards, catalog search, receipt/history, automatic schema checks and logged-out API denial. Verify no API/user data is cached or public, and no credentials appear. GOVIEW remains UNKNOWN until an exact existing command/artifact can be checked; do not fabricate a general readiness proof.
6. If acceptance fails, restore the prior Hub code/assets first, then prior GO code/assets using the saved versions. Preserve the corrected named bindings and all secrets/database state; blindly restoring a complete old configuration can reintroduce the missing-entrypoint bug. Do not reverse approval rows, receipts or audit history. Read back versions/bindings/assets again and verify the original proposal without dispatching it.

No merge, production upload, deploy, schema approval, Factory approval or rollback is performed by this work.
