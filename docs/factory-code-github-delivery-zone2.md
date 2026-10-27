# Factory CODE Receipt -> GitHub PR (Zone 2 source)

Owner outcome: CODE must not end at a Factory Receipt. Existing GO's signed Factory readback and Hub V2's existing GitHub provider now compose into one bounded handoff. This adds one GO MCP tool **inside the existing GO worker**, not another Worker, Queue, binding, secret store or parallel GitHub API client.

## Operation

`factory_code_deliver_github({ receiptId, repo, baseSha, filePath, requestId, approved:true })`

1. Re-read the existing GO-owned CODE Receipt over the signed Factory rail. Require completed verified CODE work, correct GO job identity, exactly one receipt-owned `main.js` artifact; if a Job Stamp is present it must PASS.
2. Read the original JS bytes through the existing signed GO artifact route. Independently check MIME, UTF-8, length and SHA-256. Neither a user-provided code string nor an unchecked Factory output may enter GitHub.
3. Inspect the requested GitHub repository through Hub V2. Create deterministic `code/jobs/<GOJOB-ID>` from the owner-pinned `baseSha` using the existing `github_branch` provider. The job ID cannot silently produce several branches.
4. Create **a new** owner-selected .js/.mjs file under src/scripts/examples/docs, without an overwrite SHA, with `github_put_file` and an operation-specific idempotency request ID. Read the branch file back through `github_file` and compare its exact bytes and digest.
5. Open a review PR through `github_open_pr`. Return receipt ID, Factory source SHA, GitHub commit SHA, file digest, branch and PR URL. **No merge, no deploy, no application acceptance.**

External writes are sequential and never retried by GO. Existing Hub V2 request-ID receipts are used for each stage. If a response or write is uncertain, stop with UNKNOWN, preserve branch/commit coordinates, and reconcile with independent GitHub reads; **do not issue a new request ID to retry blindly**. An existing destination file is not overwritten: `github_put_file` receives no SHA.

This is a bounded **single-file Factory CODE JS artifact** deliverer; it does not turn the current CODE Dynamic Workers sandbox into an arbitrary Node/Android multi-file build system. A real multi-file project uses the separately prepared isolated code-workspace pipeline. Nor does this handoff exercise the owner-owned PR61 Merge/Deploy gate; that distinct authority belongs downstream and is not automatically granted by PR creation.

## Acceptance and boundaries

- Unit source tests: successful complete signed-receipt shaped data -> independent byte hash -> deterministic branch/commit/verified file readback -> PR; corrupt data, wrong domain, bad stamp, invalid repo path, ambiguous side effect all fail without a false PR result.
- Repo/source compilation: check the complete GO source branch CI and independent review; do not claim a hosted tool or GitHub mutation from the mock Hub tests.
- Separate Zone 3: deploy an approved exact GO source, read back the tool catalog, run one owner-selected real Factory CODE job and confirm real GitHub created branch/bytes/PR, then review release authority and runtime before Production promotion.
- Existing GO V50-compatible OAuth, Brain, GOVIEW, Observatory, Workshop, PROOF and Job Stamp are retained; branch was based on GO merged PR36 parent `e473566551b7a4881f9ea7c7afadc235ba192211`. GO `main` is not assumed identical to current deployed source.
- Existing Factory PR62 owner-dispatched workflow remains a separate manual executor. Do not execute both for one job or claim this change merges or replaces that PR.
