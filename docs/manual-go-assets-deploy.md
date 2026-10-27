# GO manual production UI deployment (Owner approval flow)

This is a manual-only repair path for the GO dashboard's **Factory job approvals** static assets. The merged PR44 Worker API is not evidence that the current production HTML is updated. Wrangler deploys **both the current Worker source and `static/` assets**, not assets only. No Factory proposal/job is created by this workflow.

## Before enabling production execution

1. Review and merge the workflow PR **without running production**. The workflow is available for manual dispatch from `main` only.
2. Configure the GitHub Environment named **`go-production`**, with required owner reviewers / deployment branch restriction to `main` before anyone runs it. **The workflow file cannot configure environment protection by itself.** If protected environment approval is unavailable, leave production dispatch disabled and get an independent review first.
3. Configure Cloudflare credentials in GitHub Actions secrets (`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`), preferably environment-scoped. Do **not** commit tokens, reuse personal recovery files, or paste credentials in a run.
4. The token should be scoped to the **single target Cloudflare account and GO Worker**, with permissions sufficient for Workers Script/Assets deploy. Do not grant unrelated account, zone, or D1-write privileges just to fix a `401`. See [Cloudflare's GitHub Actions deployment documentation](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) for recommended Workers permissions.
5. Verify that the existing `wrangler.jsonc` matches live worker identity and bindings before dispatch; use an independent deployment snapshot and rollback reference. Secrets are retained by Wrangler, and `--keep-vars` protects existing dashboard-configured variables; these flags do **not** prove every runtime binding was preserved. This workflow performs **no D1 migration**, and existing `0002_factory_approvals.sql` must already be applied.

## Manual dispatch

Navigate to **Actions → GO | Manual Worker and approvals-assets deploy → Run workflow**.
Choose branch `main`. Enter:

- `confirm`: `DEPLOY_GO_ASSETS`
- `expected_sha`: the full 40-character `main` commit SHA selected in GitHub

The workflow must not run on PR branches or on push. The source SHA must match exactly. The `preflight` job checks existing routing, D1 and service bindings, dashboard approvals markers, PWA safety, GO Node tests and a non-uploading Wrangler build. The `production` job uses the separately configured `go-production` environment reviewer gate, then invokes the official Wrangler deploy with `--keep-vars`.

A failed assets upload, authentication failure, or `401 Unauthorized` is a **hard failure**, not a reason to copy/upload the Asset JWT manually or open access controls.

## After deploy — do not declare GO fully accepted yet

- This workflow issues a cache-bypassed, non-mutating live HTML GET and requires the `factory-approvals` panel and endpoint string. If Cloudflare Access challenges the unauthenticated request, the job fails with an **owner-authenticated readback required** message rather than claiming PASS.
- Sign in through Cloudflare Access on the actual owner's device. Confirm that the **Factory job approvals** panel and pending badge display; inspect any `Failed to fetch` network response and Access/session state. A shell loading does not prove API authentication.
- Inspect owner-authenticated `GET /api/factory-approvals` through the normal GO UI. Distinguish Access authentication, API errors, stale HTML, D1, and stale service worker; no public-access workaround.
- Only **after separately authorized testing**: propose a bounded harmless Factory job, inspect exact payload/hash, click Approve in GO, and verify one durable Factory receipt plus readback/audit status. Never auto-approve or auto-retry UNKNOWN jobs.
- Preserve a previous deployment reference for rollback. If UI/API is broken, halt further operations and use the already approved rollback path; do not erase D1 or app data.

## Evidence and limits

This PR adds the deployment mechanism, preflight and deployment readback requirements. Opening or merging the PR does not update Cloudflare or complete owner/device approval testing. The `go-production` environment configuration, secret presence and production permission readiness must be verified by the owner before dispatch.
