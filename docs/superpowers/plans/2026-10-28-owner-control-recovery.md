# Owner control recovery implementation plan

Goal: retain GO V56 and deployed Hub V21 while repairing owner access and building the existing Hub into a Thai mobile owner console.

Architecture: keep existing GO/Hub Workers, Access authentication, OAuth, D1, service bindings and Factory approval authority. Extend existing private AppTools with one bounded read; expose the snapshot only after the existing Hub Access check. UI uses real catalog, connector, receipt and approval data. No new resource, secret, queue or approval system.

The owner authorized full Zone 2 implementation without incremental design approvals. Choices: evolve current HTML/JS rather than add a framework or separate app; use existing read rails and actual audit gaps rather than fabricate status/history. Schema auto-refresh is explicitly required by the owner's follow-up: use the existing 60-second cache, visible page only, no automatic changed-schema approval or job replay.

- [x] Inspect actual active versions, service metadata, Access paths, D1 proposal and runtime module/source parity.
- [x] Repair GO login discovery, actionable fetch errors, cache policy and uncertain action UI; retain exact payload/hash approval.
- [x] Add read-only GO owner snapshot on existing AppTools and authenticated Hub owner dashboard API, with partial-failure gaps and version metadata.
- [x] Extend existing Hub mobile UI with overview, searchable catalog, Factory receipts/GO approval links, identity and actual history.
- [x] Restore automatic bounded schema refresh; keep source-version review and unknown-delivery safeguards.
- [ ] Validate paired workerd/browser paths, mobile/desktop and failure states; run targeted regressions and build.
- [ ] Review, record evidence, open isolated PR/MR, and prepare preservation/rollback/production acceptance steps. No merge or production deploy.

Review focus: missing Access session must fail closed; partial catalog failure must disable stale calls; schema failures must not hide dashboard reads; UNKNOWN deliveries must not replay; no owner secrets or proposal payloads in Hub snapshot; status and transport evidence must not imply job success.
