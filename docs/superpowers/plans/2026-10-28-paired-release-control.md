Superseded by `2026-10-28-sustainable-release-route.md` after owner direction to simplify the route.

# Paired release control implementation plan

**Goal:** Owner-authenticated ordinary-chat release plan/start/status/rollback using existing GO, Hub, D1 delivery receipts and CI.
**Spec:** https://github.com/pureekangraw-ops/Go-Together/pull/45#issuecomment-6459314086
**Architecture:** GO MCP validates owner before a private HubBridge RPC. Hub holds provider credentials and atomically reserves an existing delivery row before dispatch. One GitHub runner coordinates protected GO then protected GitLab Hub jobs. No new service/database/migration.
**Source constraint:** Original approved recovery SHAs omit the controller. Deployment must stay blocked until an exact combined source pair is reviewed; never silently switch to main or erase the controller on Hub publication.

- [x] Test invalid actions/source/approval, concurrent duplicate start, ambiguous dispatch, read-only cross-chat recovery and rollback.
- [x] Implement Hub release module with fixed targets, trusted manifest, source/config/environment checks and durable one-shot reservation. Expose only private authenticated GO RPC.
- [x] Expose GO MCP release_control, preserving existing OAuth and private app boundaries.
- [x] Adapt PR45 manual workflow to pinned checkout independent of workflow revision; isolated tests/dry-run, live drift and binding snapshot, receipt artifacts, protected runner secrets, GO acceptance before Hub.
- [x] Add narrowly scoped manual GitLab release pipeline with pipeline inputs, protected recovery branch, resource group and no changes to old exporter.
- [ ] Run targeted tests, both existing suites, dry-run builds and diff review. Publish reviewable source commits/PR/MR without merge/deploy. Report setup and real ordinary-chat acceptance separately.

Review focus: concurrent request IDs; timeout after remote side effect; stale source/tool catalog; production drift; secrets excluded from receipts. Real fresh-room publication and production acceptance cannot be claimed from local tests.
