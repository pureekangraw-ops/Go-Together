# One-work continuity catalog

Stacked on Hub V2 cutover da910a69c747b25936794499dcf2b2459901978a (PR #18).
This change publishes three google_workspace_* schemas through the existing google_* Hub route. It changes no bindings, authentication, executors or Hub implementation.

The paired prytaneion-workspace provider implements read(version), write and receipt. writeRequestId identifies a durable source operation; Hub gets a fresh transport message ID on each call. Reusing transport requestId would suppress a source retry while returning no stored source response. Reconcile uncertain writes through receipt before retrying the same writeRequestId and exact content.

One configured work has logical writer labels, version and fencing epoch. Labels are not separately authenticated actor identities. Existing private owner authorization remains the boundary. No GO execution is asserted.

Tests: node --test tests/*.test.mjs. Paired provider integration compares these schemas and exercises this actual GO handler through pinned Hub source and provider against synthetic SQLite-backed Drive HTTP responses. That is fixture proof, not live Drive/GO/Atlas acceptance. No credentials, live configuration, existing Drive content or deployment was changed.

Before live use: independent review of both stacked candidates, approved deployment preserving cutover configuration, confirmation of existing Drive write capability, and explicit authorization for one synthetic work's append-only files/configuration. No new scopes or credentials are implied.
