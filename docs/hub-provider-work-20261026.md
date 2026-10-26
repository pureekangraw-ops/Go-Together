# Hub provider integration — continuous WORK checkpoint

Continue PR #25 with HubStation MR !5. The authoritative cross-system dependency map, runtime observations, credential blockers, ten-point readout and cutover gate are in [Hub WORK evidence](https://gitlab.com/pureekangraw/hubstation/-/blob/go/work-hub-provider-capability-20261026/docs/work-hub-integration-20261026.md).

GO and Hub source catalogs match exactly: 31 provider tools (original 11 + original 17 additions + GitLab file read / Slack history / Slack edit). Provider mutations now require `requestId`; reuse the same ID to inspect an uncertain prior delivery, and use a new ID only for a distinct intended action. A changed payload with the same identity conflicts. No automatic resend occurs.

Provider failure results retain `_hubReceipt` and public MCP marks failed Hub calls as errors. Original Brain/application error contracts remain intact. Factory VISUAL upload/status/zip-chunk are now discoverable and routed through Hub to the original app-owned adapter. Factory job/upload status polling gets a fresh read receipt each time; write identity remains stable.

Code checkpoint `5825f19f2b52612ace9d8e6310138640a3cc4492`: [CI run 40312205024](https://github.com/pureekangraw-ops/Go-Together/actions/runs/40312205024), 87/87 tests. Local Wrangler 4.147.0 Worker dry-run packaging passed, retaining FACTORY_DIRECT / OBSERVATORY_GO / GOVIEW_GO / HUB_V2. No merge, production deployment, credential change or legacy retirement occurred.

Live observations are older than this candidate: 8 connectors / 38 tools; no new GitLab/Slack connector. Candidate source discovery totals 61 tools across 10 connectors. Existing Google OAuth refresh/Drive scope was observed, while seven candidate canonical Store secrets still carry placeholder metadata and are not bound in live Hub. Factory #54 still returns an unverified VISUAL receipt (404). These are unresolved boundaries: WORK is not declared complete and Cutover is not done.

The owner controls actual credential entry/migration and production release. Validate the exact paired HEADs before either action. After an authorized release, refresh source schemas/version approvals, check destination write/readback on explicitly selected test targets and reconcile UNKNOWN outcomes before any approved legacy withdrawal.
