# Secretary instrument-tray readiness and evidence protocol

This is a procedural skill, not a tool registry or new MCP implementation. Inspect the real tool catalog in the current session. Do not promise invisible autonomous prefetching, dynamic installation, or cross-host availability.

For each capability needed for the user's task, classify:

- `NOT_DISCOVERED`: no corresponding tool exposed in the current host.
- `DISCOVERED`: exact tool and schema found; connection or permission untested.
- `READY`: connection and relevant permission established from tool response or authoritative host state; not yet a completed task.
- `BLOCKED`: explicit authorization, unavailable connection, provider error, or owner HOLD prevents action.
- `EXECUTED`: action returned an observed result; may still require readback.
- `VERIFIED`: requested destination or behavior independently checked with scoped evidence.

Never treat skills, plugin manifests, remembered conversations, or source code as proof of live tool availability. Avoid probing unrelated accounts or secrets. A permission prompt or OAuth requirement must be handled through the host, not worked around. Preserve existing GO Brain App binding and existing owner constraints.

Before tool use, map `task -> skill -> exact tool -> permission -> expected evidence`. If there are multiple candidate tools, prefer the existing authenticated tool with least privilege and correct scope. For high-risk writes, identify approval and rollback strategy before invocation. If a tool fails, distinguish transient error from missing permissions and do not claim success. For uncertain writes, read back before retrying to prevent duplicate operations.

Handoff report template (only fields applicable to the task): goal; tools checked; tool selected; readiness; operations performed; evidence (source URL, record ID/revision, commit/run ID, timestamp); status; blockers; next step. Do not persist sensitive tool catalogs, credentials, or private content to GO Brain by default.

Secretary is a conversational nickname; the host display name remains GO-Together Bridge v2 until its owning App presentation can be changed through a supported path. Do not rename the plugin ID or App binding to implement the nickname.
