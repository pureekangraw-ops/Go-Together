# Runner source-transfer repair (28 October 2026)

Observed GitHub Actions run [40640403473](https://github.com/pureekangraw-ops/Go-Together/actions/runs/40640403473): preflight PASS, GitLab commit and private infrastructure reads PASS, **Hub archive download HTTP 406** at the exact source-download step; build, draft-release upload and deploy were not reached. This does not establish a bad Cloudflare token or GitLab secret.

Replace the GitLab archive endpoint with the provider-supported HTTPS Git transport, using the **same** \`GITLAB_SOURCE_TOKEN\`, a fixed private repository, the existing recovery branch, and an exact detached SHA. Git's one-run temporary askpass helper supplies the token without embedding it in commands, URL, repository config or console. Full branch history is retrieved so older pinned commits remain reachable after a merge; exact checkout SHA is verified. No new Runner, cloud account, worker, queue, or CI secret. If token lacks Git-over-HTTPS \`read_repository\` permission, fail explicitly without trying further credential routes.

Also fix the existing GitHub draft Release asset upload HTTP header to \`Content-Type: application/octet-stream\`, not JSON. Upload and download remain scoped to the existing draft Release flow; this is a source-level repair, **not** proof that a real draft artifact uploaded successfully.

The focused tests use an actual local Git repository and Git commands to verify historic SHA checkout, plus intercepted GitLab commit API and GitHub upload byte/header assertions. Network boundaries are mocked; a new protected \`prepare\` run is still required for real GitLab and GitHub acceptance.

Historical run ID/request ID stay immutable; do **not** rerun that failed attempt. A new uniquely identified \`prepare\` run, without deployment, is the next permitted action after source review, merge and CI verification. Production remains locked by \`recovery:null\` until a real draft asset ID and SHA-256 are read back.
