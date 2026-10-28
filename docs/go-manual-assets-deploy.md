# GO/Hub sustainable release route

This supersedes the dual-runner/version-rollback implementation in PR #45 and Hub MR !7, following the owner's request to change the route rather than preserve a difficult legacy deployment shape. It reuses the existing GO, Hub, GitHub repository and GitLab source. It adds no Worker, queue, database, paid service or permanent machine-authentication key.

## One deployment authority

One protected GitHub Actions job builds and releases the exact GO/Hub pair. `.github/runner` pins Wrangler 4.152.0, Undici 7.30.1 and the already-tested supplier remediation from Hub; the CLI hash is verified before each use. Dependency installation happens without deployment credentials, preserving the existing remediation instead of reverting to an unpatched global CLI. GitLab remains Hub's canonical source and existing verification pipeline. Production no longer depends on GitLab pipeline dispatch rights, protected recovery branches, protected CI variables, a GitLab deployment environment or cross-runner timing. The former Hub deployment job, runner copy and second manifest are removed. The old exporter is left unchanged and is never a deployment source.

`.github/release-manifest.json` on GO main is the one source of approved intent. Hub reads that file through its existing server-side GitHub credential. There is no duplicated RELEASE_MANIFEST runtime variable to keep synchronized. A release receipt retains the exact manifest it used; status reads still work after main changes or its provider is temporarily unavailable.

Owner OAuth, exact commit selection, atomic request reservation, one Actions dispatch, fixed provider targets, bounded status and UNKNOWN/no-replay semantics remain. Existing environment approval is respected.

## Payload recovery with current infrastructure

The runner builds/tests GO and Hub without deployment credentials, then packages their compiled runtime and GO static files in `go-hub-bundle.json`. The bundle records both source SHAs, a versioned controller ABI, a hash for every file and a hash for the whole bundle. It rejects duplicate/traversal paths, symlinks, unexpected files, altered bytes and infrastructure files. Routine ABI-2 artifacts must preserve the controller APIs. The exact packaged payload is dry-run checked against the actual deployment configuration before the protected production job.

Deployment infrastructure is separate and reviewed in GO `.github/release-infrastructure/go.json` and private GitLab Hub `release-infrastructure/hub.json`: Worker names, service destinations/entrypoints, D1 identities, Secrets Store references, Access/OAuth variables, asset routing and version metadata. Payload artifacts contain none of those configs or credential values. Wrangler preserves inherited variables/secrets; preflight checks prevent changing existing databases, destinations, Secrets Store references or explicit variable values. Legacy missing Observatory/GOVIEW entrypoints can be repaired by the current approved config instead of making the old version an impossible rollback prerequisite.

Recovery fetches the specifically approved earlier bundle by numeric GitHub Release asset ID and expected SHA-256, verifies every byte/source/ABI before any production effect, and republishes it with CURRENT infrastructure. It creates new Cloudflare version IDs. It does not reactivate a complete old version/configuration and does not rebuild old dependencies. Hub restores before GO, only after proving the current serving versions belong to the authorized release. Status verifies the recovery tag and the earlier source hashes on the actual new version IDs.

GO is a public repository and Hub is private. Both payloads are built inside the protected job; the private Hub payload/config is never uploaded as an Actions artifact or printed into public build logs. The Hub infrastructure revision is pinned separately by `hubInfrastructureSha`. Draft GitHub Release assets remain restricted to authorized maintainers and must stay drafts; publishing them would expose Hub code. They provide storage without CI artifact expiry; they are not automatically published or overwritten. Successful deployment and owner/browser acceptance are separate from artifact preparation. Only an explicitly reviewed, appropriate fallback may be pinned as recovery; a freshly built candidate or CI-green result is not automatically a proven production baseline.

## First installation and continuing operation

Before the Hub controller exists, GO's bounded machine readback can verify a GitHub OIDC signature and read its own deployed version/PENDING proposal directly. Only the exact repository ID, main workflow, protected production environment, first run attempt, short lifetime and request-specific audience are accepted. It cannot deploy or approve work.

After Hub is deployed, final acceptance also traverses the existing private GO→Hub→GO capability. A first install initiated in the owner's protected Actions environment can be adopted as a durable receipt only after the real workflow run and exact live source/version pair have been checked. Ordinary subsequent releases use the receipt reserved before dispatch. No Hub Access application or policy is relaxed.

Initial setup is explicit: select an approved fallback and review the exact combined controller source pair, install once, refresh the GO Brain catalog in ChatGPT and verify a fresh ordinary room. Until that commissioning has happened, source/tests are not evidence the tool is already live. The checked-in manifest intentionally retains `controllerReviewed:false` and `recovery:null`; it cannot silently deploy.

The first installation may explicitly set `bootstrap:true` and import the separately pinned `bootstrapSources` historical code/assets pair as ABI 0. Those pins stay separate from the new controller deployment source, so preparing the first fallback does not silently change the release candidate. `prepare` under that flag builds the legacy fallback without claiming it has controller APIs. This handles the real cold-start case: a controller cannot already exist in the previous release before its first installation. Recovery still uses CURRENT infrastructure. A legacy fallback may remove the newly installed controller; its receipt verifies code/assets/version/bindings and explicitly marks private RPC/PENDING readback unavailable rather than inventing a PASS. After successful commissioning, pin the accepted ABI-2 bundle as the baseline and set `bootstrap:false`; ordinary releases reject ABI-0 fallbacks before deployment. Bootstrap is an explicit one-time scope, not permission to downgrade controller continuity in later releases.

The workflow has `prepare`, `start` and `rollback` modes. `prepare` runs source tests/builds and creates only a draft artifact (`PREPARE <releaseId>`); it never deploys and does not certify a fallback as production-proven. `start` verifies the approved fallback before publishing or deploying anything, accepts GO before Hub, and retains one receipt. `rollback` uses a new request UUID and the original release request identity. Failed/uncertain effects are reconciled read-only before recovery; the runner never retriggers itself.

## One-time provider setup

- GitHub `go-production` secret `GITLAB_SOURCE_TOKEN`: read_repository/read_api rights for the fixed Hub project, used only in the source/config-fetch steps. It is absent while source tests/install scripts run. No GitLab trigger/deploy token is required.
- GitHub `go-production` environment: existing owner review/branch protection, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for the existing single account. The token needs Worker deploy and read-only version/settings/Access/routes inspection; no D1 writes, Access edits or secret-value reads are added.
- Native ephemeral `GITHUB_TOKEN` gets contents write only in the protected job to store draft release assets; native GitHub OIDC provides readback identity. Hub's existing provider credential needs Actions dispatch, source/asset reads and environment-protection visibility.

Keep credentials in provider settings. No token, owner pass or upload JWT belongs in chat, source, bundles or receipts.

## Evidence and limits

Local subprocess integration tests execute the real runner, bundle verification, extraction and current configuration overlay against simulated provider boundaries. They prove GO-before-Hub, stopping after failed GO acceptance, digest failure before any deploy and recovery of earlier runtime/assets into NEW versions with corrected bindings and unchanged database identities. Separate real-signature tests cover OIDC rejection/verification; real SQLite tests cover deduplication, request conflicts, timeout/no-replay, status continuity and first-install receipt adoption.

Read-only production metadata was compared against the new infrastructure plan for both Workers; their legacy bindings fit the plan. Production remains unmodified. Full repository suites, dry-run builds, source-provider CI and real production verification must be reported separately. Fresh ordinary-chat catalog invocation, owner mobile/desktop login, actual artifact retention/credentials and an authorized production recovery drill remain NOT VERIFIED until commissioning. A failure or absent permission returns one precise blocker instead of an automatic loop.


### Prepared first-install fallback

The previously reviewed GO #47 / Hub !6 pair was built into a local legacy fallback: GO source `5f8f99cb1debcf2cb5677645357be1491153c332`, Hub source `dbfbdd715018722355041da50dcdb68188d9d485`, ABI 0, SHA-256 `b75bc87c85cd3f2428dd16a3c39f061c4d177e0167579be83b4fc8921b0afd89`. Its source suites passed 170/96 tests and both dry-run builds passed. It is a reviewed source fallback, not a claim of prior production acceptance.

The current cloud session could create a private draft but its uploads.github.com request returned HTTP 401. The empty temporary draft was removed after readback; no remote asset is claimed and no upload was retried. The local sealed bundle is retained for owner review. The protected workflow's `prepare` mode uses GitHub's native ephemeral token on the runner, rebuilds the pinned bootstrap sources, and stores its resulting digest/asset ID for the approved manifest. This requires actual runner commissioning; `recovery:null` remains a truthful block until an asset is available.
