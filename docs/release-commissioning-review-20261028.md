# GO/Hub commissioning source review — 28 October 2026

## Current reviewable candidate

- GO payload: `c7ab6e4bf5b4a42b77c272b39d6f6057086f8c15` (Worker runtime unchanged by this follow-up).
- Hub payload: `309b54caaba92e7c8a25e729107a2d7a8d74e3a2`, on [HubStation MR !7](https://gitlab.com/pureekangraw/hubstation/-/merge_requests/7).
- Hub infrastructure remains separately pinned at `fa08389d72997860af123489bfdb7124b45b29fa`; its configuration was not edited.
- The protected runner executes the reviewed GO main controller after source approval/merge. This follow-up changes that runner's early validation, not the GO Worker payload.
- `controllerReviewed:false`, `recovery:null`, and the existing bootstrap source pins remain deliberate commissioning gates.

## Defects corrected in this review

1. Hub now requests GitHub's `return_run_details:true` and stores the validated positive integer run ID in the existing dispatch receipt. Status reads use that exact ID even after more than 100 newer runs. Plan/status remain read-only; URLs are derived from the fixed repository. Empty, malformed or lost dispatch responses stay UNKNOWN without replay.
2. Failed-start readback recognizes a restored worker plus the other worker's exact untouched baseline. Recovery still requires the original request tag and approved fallback source. Unrelated production drift remains UNKNOWN; explicit rollback still requires both restored workers.
3. The runner rejects any defined `GITHUB_RUN_ATTEMPT` other than `1` before manifest/provider/deployment work, matching the existing OIDC contract. That refusal does not create or overwrite a receipt. Deliberate local fixtures may omit the CI variable.

## Verification and limits

- Hub focused suite: `node --test --test-isolation=none test/release-control.test.js` — 23 passed (17 existing plus 6 regressions). Both reported defects were reproduced before patching. Tests use the real controller and in-memory SQLite with simulated provider responses; status leaves database rows unchanged.
- Hub exact-source CI: [pipeline 2997487522](https://gitlab.com/pureekangraw/hubstation/-/pipelines/2997487522), SUCCESS at `309b54caaba92e7c8a25e729107a2d7a8d74e3a2`.
- GO focused runner suite: `node --test --test-isolation=none tests/paired-release-runner.test.mjs` — 10 passed. Real subprocess regressions prove later attempts make zero provider calls and preserve/no-create receipts; attempt 1 reaches an intercepted read-only preflight. All network calls were intercepted.
- The earlier 197 GO / 115 Hub counts in the initial route evidence describe the pre-review candidate. This follow-up adds three GO and six Hub regressions; it does not recast those earlier test results as new production evidence.
- Historical or timeout-ambiguous receipts without a run ID are not backfilled. Their bounded lookup may remain UNKNOWN; no implicit redispatch is added.
- No recovery upload, runner commissioning, production deployment, owner-browser test or actual fresh-room release-control invocation has been performed by this follow-up.

## Live read-only checkpoint

At 2026-10-28 04:51:46 UTC (11:51:46 Asia/Bangkok), existing GO→Hub Cloudflare reads returned:

- GO: version `45c62178-6991-4ed9-a35c-314eca1e98fa`, 100% traffic, deployment `86fa5829-3d8d-454c-aa2a-269642c48054`.
- Hub: version `9f631634-e9dd-4682-bf10-ccafe3d79819`, 100% traffic, deployment `33747fcc-3a36-4e00-8136-89351d0fbd6d`.
- Factory approval `187e2e08-52f6-4cf6-afec-5baa663446d1` was read at 04:46:29 UTC and remained PENDING. No Factory execution or approval was issued.

These observations match the manifest baseline at that time; repeat baseline checks before any authorized production mutation.

## Remaining commissioning boundary

The earlier HTTP 401 was at `uploads.github.com` from the prior cloud session. It was not a native runner failure and does not establish Cloudflare credential failure. The protected native runner's prepare route still requires reviewed source installed on main, the `go-production` environment/protection, and its GitLab read credential. Prepare uses ephemeral GitHub credentials and requires no Cloudflare deploy token. A real draft recovery asset and digest must be read back before pinning it.

The current native GitHub connector exposes no Secrets/environment-administration, workflow-dispatch or release-asset-upload operation. This is a capability boundary, not evidence that the owner's existing settings are absent. Credentials belong in provider settings. Explicit scoped production authorization and actual fresh ordinary-chat/second-room proof remain outstanding.

## Primary API references

- [Workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [Run IDs added on 19 February 2026](https://github.blog/changelog/2026-02-19-workflow-dispatch-api-now-returns-run-ids/)
- [Additive API changes apply to supported versions](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes)
