# GO Brain: Operational + Evolution context (Zone 2 candidate)

## Intent and ownership
GO is the user and decision maker. GO Brain stores source-linked memory and prepares bounded evidence. It does not independently think, dispatch Work, grant permissions, rewrite training weights, or infer new facts. The two *views* below are not two separate databases, services, or AI models:

- **Operational:** Prioritize Work/checkpoint/decision/handoff records so GO can resume useful work. For a versioned `go-brain-r2.1/work-item/v1` JSON record, its author-written `checkpoint.next_action` can be displayed verbatim.
- **Evolution:** Prioritize RCA/analysis/experiment/lesson records for GO to review and decide what to improve. A candidate lesson is **not** automatically trained into any model or promoted as verified policy.

Both views use the exact same existing D1 memories and lexical-v2 `search`. No schema change, new provider, new secret, new tool-execution route, private-data export, or model inference is introduced.

## New bounded read-only interface

- MCP `brain_context({query,mode?,limit?})`
- Owner web `GET /api/context?q=...&mode=operational|evolution|all&limit=1..15`
- Mode defaults to `operational`, limit defaults to 10.
- Response type: `go_brain_source_context_v1`.
- Every returned record has exact D1 `record_id`, `revision`, `memory_updated_at`, `lexical_score`, `status`, `confidence`, `external_evidence_pointer`, `work_id`, bounded `excerpt`, and relevant warning flags.
- `external_evidence_pointer` is a **stored pointer**, not independently verified. `memory_updated_at` is not evidence that the underlying source changed or stayed current: `source_updated_at` remains null.
- `mode` changes grouping/prioritization, NOT record authority, contents or lexical search relevance. It cannot claim complete project retrieval; baseline search scans the latest 2,000 non-deleted active/needs-review records and uses lexical matching.

## Examples for GO

1. Work continuity: query an exact project/work topic with `mode=operational`, retrieve the selected record by ID when an excerpt is truncated, and verify the cited Source of Truth before acting.
2. RCA: same topic with `mode=evolution`; compare lessons, outcomes and warning flags; GO determines hypotheses and tests, and logs outcomes back through existing owner-authorized memory writes.
3. A mixed context may use `mode=all` to preserve lexical score order.

`brain_context` is a small supporting tool, not an automatic workflow orchestrator. Never turn an LLM suggestion into an approved dispatch. Work truth remains with its original Owner Source.

## Relationship to other development

The existing Draft PR #1 (Knowledge Note lifecycle) predates this work and must not be blindly merged or overwritten; reconcile its explicit evidence-gated learning semantics separately. Greenhouse/Colab is the development environment for a future small AI; the released inference runtime remains a separate Owner-selected location. GO Brain is the GO memory/evidence service, not that runtime.

## Verification and rollout

- Run `node --test tests/brain-context.test.mjs` followed by `node --test tests/worker.test.mjs`.
- Check tests for ordering, no fabricated source freshness, revision provenance, the structured Work schema, input nonmutation, owner-only HTTP and MCP read-only behavior.
- Before promotion, independent reviewer checks exact branch and runs test suite; compare MCP catalog in a staging/isolated environment, then verify through an actual authenticated ChatGPT GO Brain connector. CI alone does **not** verify hosted runtime.
- No Production merge/deploy, Cloudflare bindings, permissions, database migrations, training or Greenhouse production actions are part of this draft.
