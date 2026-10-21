# GO Brain R2.1: independent work checkpoints

Owner approved on 2026-10-21: keep exactly two primary groups, in progress and completed. Work type and room are optional labels. One work item gets one memory, with its own optimistic revision. The existing index becomes a compact set of pointers, not a second work authority.

## Write-response repair

The production D1 fixture confirmed `meta.changes = 2` for one memory update: one memory row plus the `memories_au` history trigger. The previous `changes !== 1` test returned a false conflict after committing. An atomic `UPDATE ... WHERE id=? AND revision=? RETURNING *` now returns the exact committed snapshot. An empty result still rejects a genuine competing write. This also avoids accidentally returning a later writer's revision from a separate SELECT.

Tests use real SQLite with the production schema and calculate D1-compatible `total_changes()` deltas. Regression coverage includes the audit trigger, stale revisions, a race after the initial read, HTTP/MCP/status routes, independent records, and a second write before the first response. Baseline 39/39 passed; new regression 2/6 passed before repair (four expected failures); full repaired suite 45/45 passed locally. No schema, credentials, auth, bindings, memory history or other MCP contracts change.

## Existing memory API contract

Use `kind: work_item`, normal memory lifecycle `status: active`, and JSON `content` with schema `go-brain-r2.1/work-item/v1`:

- `index_id`: the existing coordinating Brain memory ID.
- `source_key`: exact canonical source locator plus a bounded work scope, used for search-before-create deduplication. Two different tasks at the same project URL must have different scopes. This is not a WorkID.
- `group`: `in_progress` or `completed`.
- `title`, `owner`, `detail_status`, `types`, `rooms`.
- `definition_of_done`: concrete outcomes for the bounded task.
- `subtasks`: named checklist items with state, evidence and next action. Existing work can instead be linked by `parent_record_id`; only use observed real record IDs.
- `checkpoint`: source references/versions, checked date, done/pending, next action, limits and source/test/deploy/customer acceptance evidence.
- `completion`: scope, evidence and dates when known; no fabricated completion timestamp.

Top-level `work_id` remains an optional pointer to an existing PANTHEON/Work record. Never use it for a generated tracking ID. The normal Brain server validates memory fields; the work JSON, deduplication and completion rules are a GO-operated convention, not new server-enforced work APIs.

## Update and completion

Search for the exact `source_key` in work_item records with status=all before creating. Retrieve matches and compare the full key, not lexical score. Update an existing match with its current revision rather than creating a duplicate. If a create response is uncertain, re-search and retrieve before retrying. Concurrent first creation still requires coordination because no uniqueness constraint is introduced.

Update only the relevant work record using expected_revision. Retrieve and inspect history after writing. On a conflict retrieve/merge instead of replacing another writer's content. A parent stays in progress while any required outcome is unverified. Move to completed only with evidence for the stated scope. Reopen when new work is required and preserve prior completion evidence in history.

The compact index caches title, owner, group, next action, source-check timestamp and Brain record ID/revision. Retrieve the task before a decision; its record supersedes any stale index summary. Updating a task does not automatically refresh the index. Keep proposed ATLAS work in roadmap context until actually started.

## Safe split of the original index

1. Read the latest index and keep its existing revision/history.
2. Search for each source key; create or reuse individual records without copying source documents wholesale.
3. Verify every record and its original checkpoint before changing the index.
4. Compare the index revision again; merge any concurrently changed items before replacing only its full work details with pointers.
5. Verify exact index content and history. Keep a migration receipt mapping old work titles to real new memory IDs.
6. Archive synthetic acceptance fixtures after readback; never delete user memories.

No automatic cross-chat monitoring, Notion changes, Factory dispatch or ATLAS integration is introduced. Actual retrieval from a second real chat remains a separate acceptance check.
