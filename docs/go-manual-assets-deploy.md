# Ordinary-chat GO/Hub release control — implementation and commissioning

Acceptance contract: https://github.com/pureekangraw-ops/Go-Together/pull/45#issuecomment-6459314086

## What this change implements

GO advertises `release_control` on its existing OAuth-protected MCP endpoint. Only the authenticated owner can call it. It is excluded from the app-owned Hub MCP relay so provider input cannot become release authority. The private `HubBridge.releaseControl` uses existing server-side provider credentials, fixed repository/project/account/Worker targets and the existing D1 `deliveries` table. No migration, database, service, queue or Factory proposal is created.

- `{"action":"plan"}` reads pinned sources, real production versions/binding metadata, GitHub protection and the GitLab protected branch. It returns precise blockers; source or permission uncertainty does not trigger CI.
- `start` requires `releaseId`, exact `goSha` and `hubSha` from the plan, a new UUID `requestId`, and `authorization: "DEPLOY <releaseId>"` after the owner's explicit release instruction. This is a deployment action, not a general permission to deploy other source.
- `{"action":"status","requestId":"<same UUID>"}` reads the existing receipt/run and independently checks Cloudflare. It never starts/retries CI. Failed CI with changed production is UNKNOWN, not proof that nothing happened. Run correlation becomes durable when the authenticated runner first reads private acceptance.
- `rollback` uses a new request UUID and `authorization: "ROLLBACK <releaseId>"`; its existing start receipt supplies the original deployment request identity. It restores real prior versions Hub then GO only after binding parity and source ownership checks. It never forces Cloudflare's secret-change safety check.

One atomic receipt reserves each release/action and each request identity before dispatch. Repeated start cannot deliver another workflow, even after a lost response. Different requests cannot claim the same release/action. No automatic release reruns are implemented. Runner status polling is bounded and never retriggers jobs.

## CI sequence

The workflow revision and deployment source revision are deliberately separate. The workflow runs on main, validates `.github/release-manifest.json`, and checks out its exact approved GO payload SHA. Both Node regression and credential-free Wrangler 4.152.0 build run before the protected production job. Runtime and `static/` publish together with `--keep-vars`; Wrangler handles temporary asset JWT internally.

Before any deployment the runner checks real active versions, recoverability, binding metadata, routes/domains and Access policy fingerprints. It refuses a rollback version that would lose the reviewed named Observatory/GOVIEW entrypoints. After GO it checks version annotations, all preserved bindings, real served HTML bytes, no-store headers, logged-out API denial and private Hub→GO ownerStatus/PENDING readback. Only then does it create one GitLab pipeline and play one protected manual recovery job. GitLab builds the exact approved Hub SHA, not main or the old export artifact. Normal verify/export jobs are excluded from release pipelines. Existing exporter pins remain unchanged.

The protected GitHub job uses native ephemeral OIDC (`id-token: write`) for read-only private acceptance. GO's `/_release/acceptance` verifies no identity locally: it forwards bounded OIDC evidence through its existing private Hub binding. Hub validates GitHub's signature, issuer, request-specific audience, exact repository ID, main workflow, protected environment subject, first run attempt and the already authorized D1 receipt before using `GO_APPS.ownerStatus`. No new permanent credential is required and Hub's whole-domain Access application stays intact. The readback updates only its own release receipt correlation; it cannot deploy or approve Factory work.

If acceptance fails, recovery first reconciles both live versions and checks every rollback target, then restores only versions provably owned by this run. Unexpected live work or unsafe bindings block recovery rather than overwrite it. GitHub and GitLab retain nonsecret receipt artifacts. A lost/uncertain external mutation is never retried automatically.

## Commissioning blockers — deployment is intentionally disabled

The checked-in manifest has `controllerReviewed: false`. The originally approved GO #47 and Hub !6 sources do not contain this controller. Deploying either original source over the controller would remove its ordinary-chat capability. Review and pin a combined source pair containing these changes; never silently substitute latest main. Keep the trusted manifest identical in GitHub `.github/release-manifest.json`, GitLab `releases/owner-release-manifest.json` and Hub's nonsecret `RELEASE_MANIFEST` runtime variable. Manifest commits can follow the pinned payload commits, avoiding a self-referential commit hash. These are configuration revisions, not a different requested product.

Fresh live readback on 2026-10-28 still showed GO `45c62178-6991-4ed9-a35c-314eca1e98fa` and Hub `9f631634-e9dd-4682-bf10-ccafe3d79819`, each at 100%. The GO rollback version still has null Observatory/GOVIEW entrypoints. Consequently `ROLLBACK_BINDINGS_UNSAFE` is a real blocker, not a hypothetical warning. A recoverable version with the corrected bindings and verified prior code/assets must be prepared and owner-reviewed before enabling the paired release. This patch deliberately does not mutate production to manufacture that prerequisite.

Fresh GitLab readback confirmed the recovery branch is currently **unprotected**. GitLab CI lint returned HTTP 403 with the available environment credential; server-side CI configuration validation is NOT VERIFIED. The current session's GitHub environment/secret metadata reads returned 404. This means `go-production` is absent or not visible to that credential; it is not proof that secrets are missing. Do not attempt production until environment protection and runner readiness can be positively checked.

One-time owner setup, in provider settings only:

1. GitHub `go-production`: required owner reviewer, deployment branch restriction to main, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and scoped `GITLAB_RELEASE_TOKEN` able to create the release pipeline and play its job.
2. GitLab protected recovery branch, protected `hub-production` environment, protected/masked `CLOUDFLARE_API_TOKEN` and protected `CLOUDFLARE_ACCOUNT_ID`. Pipeline inputs are used, not arbitrary pipeline variable overrides. The existing project setting forbidding variable overrides remains unchanged.
3. Cloudflare token permissions for the single account/Workers deployment plus read-only version/settings, Access apps/policies and zone route inspection. No Access edit, D1 write or secret-value read is requested. Hub dispatch credentials separately need GitHub Actions write and source/environment read; a provider connection alone does not establish runner readiness.
4. Bootstrap the reviewed combined controller through the existing protected release rails. Update and recheck the real post-bootstrap baseline, then refresh the existing ChatGPT GO Brain connector catalog. No claim is made that these review branches are already published tools.

## Verification and completion boundary

Automated tests cover real SQLite idempotency/concurrency, wrong source/action/authorization, 401 without retry, uncertain delivery without replay, duplicate identity across actions, CI-green/version mismatch, private relay isolation, binding/rollback guards, OIDC signature/audience/receipt binding and private PENDING readback. Both full repository suites and Wrangler dry-run builds are required.

Local tests are not proof of CI credentials, protected environment approvals, production deployment, real mobile/desktop login or fresh ordinary ChatGPT discovery. Even a successful runner/version/RPC check is reported as deployment success with `OWNER_ACCEPTANCE_PENDING`, not overall completion. Real owner-browser, catalog refresh, fresh-room invocation and cross-room status recovery remain required. There has been no production deployment, Access change, secret configuration, Factory job or approval in this implementation session.
