# Bridge boundaries

Preserve existing plugin identity, GO Brain App asdk_app_6aca401b8d848191a5aa1b5cc95f362a, OAuth/CIMD/PKCE, owner principal and D1. Skills are instructions, not grants of tools or permissions. Never extract owner passcodes, access/refresh tokens or WorkHub secrets.

GO MCP endpoint: https://go-together.pureekangraw.workers.dev/mcp .
Authenticated GO calls use named Service Binding PANTHEON_OWNER -> existing phatheon-workhub / OwnerBridge. The bounded receiver validates operation and inputs, then invokes existing PANTHEON API policy with its own server-side WORKHUB_TOKEN. Public HTTP authorization is unchanged. No generic URL/header forwarding is exposed.

Use actual tool discovery and BIG's current instruction. The historical read-only integration HOLD was superseded by BIG's 2026-10-14 order to complete/deploy/test GO -> PANTHEON -> Factory. This does not authorize unrelated pairing, destructive actions, payments, production changes inside Factory or LIGHT integration.

Factory dispatch and reconciliation require an existing task_id and approved:true in addition to an explicit human request. Queuing does not dispatch. Do not retry uncertain dispatch without correlated readback/reconciliation. Supported execution is bounded LOGIC training placement; do not claim CODE/VISUAL production capability.

Brain read tools: search/retrieve/list/history/summarize. Brain write tools: save/edit/status. Existing brain-owner scope is not separate enforced read/write scopes. Preserve permission settings.

Metro Plugin remains prohibited by BIG. Preserve the independent existing auth route.

PLANNED: proposed. BUILT: exact code/artifacts exist. TESTED: checks ran. VERIFIED: the stated behavior was observed at the required destination. Server deployment, server catalog discovery and actual ChatGPT invocation are separate evidence boundaries.

Merged source: https://github.com/pureekangraw-ops/Go-Together/pull/3 and https://github.com/pureekangraw-ops/Pantheon-WorkHub/pull/9 .
