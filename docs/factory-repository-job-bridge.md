# Factory repository job bridge — source candidate

The existing `factory_direct_propose` accepts CODE with `spec.repositoryJob`:

```json
{"domain":"CODE","requestId":"<new UUID>","spec":{"repositoryJob":{"baseSha":"<reviewed Factory main commit>","files":[{"path":"docs/result.txt","content":"owner-reviewed output","expectedBlobSha":"<existing blob SHA, omit for new file>"}]}}}
```

This mode delivers already prepared source files; it does not generate an application or run arbitrary build commands. It is limited to the existing `pureekangraw-ops/Factory-District` repository, 16 text files and a 48 KB aggregate UTF-8 content budget. Other Factory modes remain unchanged. `githubDelivery` and repositoryJob cannot be combined.

The same owner inbox records the immutable payload hash, claims approval once, then calls the existing Hub V2 GitHub provider. Two internal provider operations dispatch `code-repository-job.yml` on reviewed main and read results. These operations are not exposed as callable GO public MCP tools; there is no new submit route, Worker, Queue, secret or runner. The Hub uses its existing credential and durable relay reservation. An ambiguous dispatch is never replayed.

The existing approval status action reads the correlated workflow using the original request ID and base SHA. It requires successful workflow completion, one matching PR, a commit parent equal to the approved base, and an independent SHA-256 comparison of every file read from that exact commit before marking the approval complete. Missing or mismatched evidence stays UNKNOWN. Completion means source delivery only, never application acceptance.

Dependencies before activation:
- Factory-District PR64, including run-name correlation and GITHUB_SHA/base pin.
- HubStation candidate based on provider work branch `6d9a887393fb299d3a009683fbe00d98b87268e3`; main lacks the existing provider writes. Review this bridge on that branch, not by replacing runtime with stale main.
- This GO candidate based on `fa2ad1ff7ddab59344df69cda637e323ea59c624`.
- Review/refresh the changed Hub and GO tool schemas as part of the existing release procedure.

No production activation is performed here. Live workflow dispatch, actual credential Actions permission, PR creation policy, receipt readback and recovery acceptance remain unverified. A PR created with GITHUB_TOKEN must not be assumed to trigger ordinary pull_request CI; CI status is explicitly NOT_VERIFIED. Workflow dispatch acceptance is not completion. Readback examines at most 100 runs for the exact base; absent old jobs remain UNKNOWN, never replayed.

After recovery is independently proven and the matched source set is released, use one new owner-approved request ID once, then reconcile read-only. Do not reuse old ambiguous jobs, switch source pins silently, merge or deploy as a side effect of this bridge.
