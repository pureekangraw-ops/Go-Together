# Factory owner approval workflow

Factory job proposals are staged in the owner-only GO-Together dashboard. Staging a proposal never calls the Factory machine. The GO dashboard keeps a persistent pending queue; there is no Slack, email, or browser push notification in this phase. The queue refreshes while the dashboard is open and remains available when the owner returns.

## State and authority

1. GO creates an immutable proposal with a generated job request ID and SHA-256 over the canonical payload.
2. The owner opens the payload in the GO dashboard, checks the review confirmation, then chooses **Approve & run** or **Reject**.
3. The approve endpoint requires the owner-authenticated, same-origin browser request and exact payload hash. It records approver identity, time, and hash, and atomically claims the proposal before dispatching once over the existing signed GO→Factory rail.
4. A trigger appends proposal, approval/dispatch, result, and rejection state changes to the approval event history.
5. A status check only reads Factory status and may update the recorded state. It never submits or retries a job. Ambiguous results remain `UNKNOWN` and require human reconciliation; they are not replayed.

The previous direct submit tool is removed from GO's tool catalog; the replacement `factory_direct_propose` can only stage a proposal. The only dispatch path is the owner-click API. The approval does not authorize GitHub merge, production deployment, or application acceptance.

## Notification and rollout

The notification surface is the GO-Together dashboard's **Factory job approvals** panel and pending-count badge. This is persistent in-app visibility, not a push alert if the page is closed. No notification service or credential is added.

Apply `migrations/0002_factory_approvals.sql` before deployment. The GO Factory tool catalog changes and must be refreshed/reviewed in Hub once; that schema review is separate from each owner approval click. Deploy only after migration, CI, and exact source review. Production deployment and the one-time Hub schema approval are not performed by this change.

## Scope and limits

Only the existing bounded CODE, VISUAL, LOGIC, and PROOF Factory submission path is covered, including the existing optional CODE→GitHub PR handoff. It does not wake or activate the dormant VISUAL queue, add background notifications, merge PRs, or deploy production.
