# Memory Card phase 1 implementation plan

Goal: One source memory, a read-only card, explicit source time/work state, revisioned metadata and optional idempotent save.
Architecture: Add metadata JSON to the existing memory row and history snapshots. Add immutable save-request fields on that row, a unique partial request index, and a stored original save response. No new service or AI calls.
Scope: Owner approved phase 1 in chat. Execute inline, no agents, merge, push, deployment or remote migration. Work on codex/brain-memory-card-phase1 in the existing checkout.

## Contract
- Keep existing memory responses compatible; add metadata only. New brain_card({id}) returns card/source with revision and warnings; legacy work-item JSON is read without rewriting it.
- Metadata: context, work_status, occurred_at, effective_at, source_updated_at, source_verified_at, source_refs. Unknown is null. No inferred freshness or confidence.
- Save accepts optional request_id. Same normalized payload replays exact creation snapshot; changed payload with same key conflicts. Replay never restores or updates the current memory.
- Metadata updates use existing expected_revision and history trigger. No AI-derived fields in this phase.
- Additive SQL migration with old history left unchanged. No migration execution on remote DB.

## Tasks
- [x] Write real SQLite integration tests for card, legacy work items, metadata validation/history, retries/concurrency, deleted replay and migration preservation; observe RED.
- [x] Implement metadata validator/card module, schema/migration, atomic idempotent insert and MCP/HTTP card exposure; observe GREEN.
- [x] Run full local suite, routing assertion and Wrangler dry-run. Review diff and document deployment/migration constraints.

## Review focus
Concurrent same-key saves must produce one memory/history event; distinct request payloads must conflict. Metadata must not silently invent dates. Deleted request replay must not revive data. Old rows/history must survive migration. Authenticated standalone Brain must expose card and reject unauthorized access.

## Decisions
Use a feature branch in the existing clean checkout; no additional worktree or agents. Use same-row JSON metadata so current compare-and-swap and SQLite triggers remain atomic. Keep request identity internal and omit it from history/card. No commits unless requested.

## Execution record
- RED: new integration tests rejected metadata/request_id and lacked card support before implementation (5 failures, 1 validation pass).
- GREEN: feature tests, revision regressions and existing full suite pass; 228/228 tests, no skips.
- Standalone-specific test caught missing card in Access local-routing allowlist; added it and reran successfully. Hub routing is preserved.
- Additive migration exercised against baseline memory/history fixture; source rows and old history snapshots preserved, future metadata history and SQLite integrity check passed.
- node scripts/assert-current-routing.mjs passed. Wrangler 4.152.0 dry-run passed for wrangler.brain.jsonc and wrangler.jsonc. git diff --check passed.
- Manual whole-change review performed; no agent created as instructed. No remote DB access/write, AI API, commit, push, merge or deploy performed.
- Limitation: local SQLite and dry-run evidence only. Hosted D1/connector acceptance and actual migration/deployment remain unverified and outside this execution.
