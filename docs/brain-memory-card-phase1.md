# GO Brain Memory Card — phase 1

Owner-approved scope: card view, explicit metadata, existing lifecycle/revision/history, optional idempotent saves. No Keyword Finder, search redesign, AI provider, pricing, new service or UI.

## Interfaces

- `brain_card({id})` reads a card at the current memory revision, including archived/deleted records by exact ID. It never writes. Available in the standalone Access Brain and local app MCP implementation.
- Owner app HTTP: `GET /api/memories/:id/card`. Standalone Brain intentionally keeps its existing HTTP API restrictions; use MCP there.
- Existing `brain_save` and `brain_edit` accept optional `metadata`. Existing clients can omit it. `brain_retrieve`/list/search records have an additive metadata field; internal save receipt fields are never returned.
- `brain_save` accepts optional `request_id` (1–128 ASCII letters/digits/dot/underscore/colon/hyphen, first character alphanumeric). Generate once per intended save and reuse unchanged on transport retry. Without it the original create-on-every-call behavior remains.

## Source and metadata

`metadata` is an object with only these fields:

```json
{
  "context": "Owner agreement about Beaver",
  "work_status": "design_pending",
  "occurred_at": null,
  "effective_at": "2026-11-12",
  "source_updated_at": null,
  "source_verified_at": null,
  "source_refs": [{"locator": "user://owner-agreement", "revision": null}]
}
```

Dates are explicitly supplied ISO calendar dates or UTC timestamps, never inferred. Strings have bounds; unknown scalar fields normalize to null and source_refs to []. References support the existing http/https/notion/user locator families. A verification date is an author's assertion, not server verification of external content.

`brain_edit` replaces the complete metadata object when supplied (it is not a nested merge). Omit metadata to preserve it; send {} to clear it. Use expected_revision for every edit. Metadata is stored on the same row as source and changes atomically with revision and trigger history. Old history snapshots remain exactly as originally stored and may lack metadata.

Card lifecycle_status comes directly from memory.status. work_status is separate; known legacy `go-brain-r2.1/work-item/v1` detail_status/group can be read without rewriting content. Metadata work_status takes precedence when non-null. Card memory timestamps never substitute for source freshness. Source text, evidence pointer, tags, outcome and work pointer remain available in the card. Warnings do not change stored confidence or status. No automatic fact verification or date extraction occurs.

## Idempotency and races

A unique partial index arbitrates request IDs in the same INSERT as source/history creation. A winning insert stores a normalized payload hash and immutable original response. Concurrent same-key calls create one memory and one history event. Same key with changed normalized content returns request_id_conflict (HTTP 409 or MCP isError); no mutation occurs. Normalization includes existing trimmed/default fields and fixed-order metadata; tag/reference array order remains significant.

A replay returns the original creation receipt, even after edits, soft deletion or restore. It is not a current-state read. Use brain_retrieve/brain_card to read current state. Receipts and request IDs persist for the life of the memory row, including soft deletion. This costs approximately one extra original payload for keyed saves; it avoids duplicate memory/history records and does not introduce a second memory authority. Physical deletion is outside phase 1 and would need an explicit receipt-retention decision.

## Migration and release constraints

`schema.sql` is the complete fresh-install schema. Existing databases need `migrations/0002_brain_memory_card.sql` exactly once before running the new writer. The migration adds columns/index and replaces the two memory history triggers; it does not rewrite memories or historical snapshots. Do not apply the full schema.sql to an existing DB or blindly replay historical migrations. Inspect the actual schema and migration ledger first. Back up and apply using the existing approved D1 transactional migration mechanism; no remote migration is authorized or performed by this change.

Deploy the code to the actual Brain runtime selected by its existing configuration (`wrangler.brain.jsonc` for standalone). The default wrangler.jsonc targets Hub-facing routing; it is not proof of the standalone Brain deployment. Preserve existing Hub routes; no other repository is modified. Schema/consumer compatibility and authenticated hosted acceptance still require a separately authorized release.

## Verification

Real SQLite tests cover card provenance, metadata/history, optimistic conflicts, lifecycle transitions, malformed input, legacy work JSON, idempotent replay after deletion, concurrent same-key saves, standalone auth, owner HTTP card and additive migration preservation. Existing full repository suite and both build entrypoints must pass locally. These do not establish production acceptance.

Local result (2026-11-12): 228/228 tests passed with no skips; routing assertion, git diff --check and Wrangler 4.152.0 dry-run for both entrypoints passed. No migration/deployment executed against Production. Work remains on codex/brain-memory-card-phase1, uncommitted for owner review.
