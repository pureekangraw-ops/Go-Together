# Factory CODE -> GitHub -> CI -> reviewed release (third path)

Stage: Zone 2 integrated source implementation. No new Worker, Queue, Hub, secret or provider. Do not claim the new GO action is deployed until separately verified on the V52 production runtime.

## One owner command
factory_code_run_to_github accepts requestId, approved=true, codeSpec, repo, baseSha, filePath.

1. Invoke the existing signed Factory CODE machine once using the exact request ID and bounded baseSource + patch + 1-8 assertions. Return UNKNOWN and forbid retry if the execution was uncertain.
2. On GO_FACTORY_DELIVERABLE_READY, independently read the Factory Receipt and its main.js artifact, check origin and SHA256. Never trust submitted inline code as an output.
3. Use existing Hub V2 GitHub provider for deterministic per-job branch, file commit, file readback and review PR.
4. Return CODE_PR_READY_CI_PENDING with PR coordinates, digests, reviewRequired=true, merged=false, deployed=false. Existing GitHub pull_request CI runs separately; not claimed completed yet.

## Existing downstream path
- Repository GitHub Actions test and build the PR head using the repository's existing CI definition.
- After CI and independent review, the owner or explicitly authorized release operator may merge.
- Factory deploy.yml still uses owner-controlled workflow_dispatch and production environment. Its existing workflow tests, deploys private machinery first, then Factory, and checks the exact live source SHA.
- PR61's managed CODE release gates require an independently deployed repository-aware provider and distinct MERGE:CODE authority; they are off by default. A 64-char sandbox digest is not a Git commit SHA.
- No unconditional auto-merge or production auto-deploy is activated by this change.

## Acceptance, limits and evidence
- tests/factory-code-one-command.test.mjs covers one Factory effect, approval/scope, fail closed on UNKNOWN, no retry, cross-job identity and MCP registration.
- tests/factory-code-delivery.test.mjs already covers independently hashed bytes, GitHub branch/commit/readback and native Hub write response formats.
- Current CODE generation is bounded single JavaScript Worker module, not general-purpose multi-file Node or Android app creation.
- The real older CODE receipt was delivered into Factory PR63 via existing Hub GitHub tools with exact readback. That does not prove the new one-command tool is deployed or live CI/deploy integration.
- GO V50-compatible source branch cannot blindly replace live V52 runtime: preserve latest Brain/context/reference and existing bindings/assets when promoting.
- A full unattended production release needs a separately scoped release authorization plus real merge/deploy provider integration and independent Cloudflare readback, without creating a duplicate orchestrator.

Source-stage completion is not runtime acceptance.
