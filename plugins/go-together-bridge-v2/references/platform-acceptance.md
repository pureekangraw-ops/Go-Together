# Acceptance evidence

Keep ChatGPT Web, Android native, mobile browser, server catalog and production runtime distinct. Package publication does not refresh or verify an existing host's cached MCP catalog.

Verify owner versus anonymous calls, input restrictions, missing bindings/credentials, upstream errors, exact task readback and explicit Factory approval. Preserve Brain CRUD/OAuth regression checks and existing WorkHub/Observatory behavior.

Current observed evidence on 2026-10-14:
- Local combined Node suite: 43/43; Python: 3/3.
- GO CI run 38533353806 succeeded.
- GO and PANTHEON deployed with existing DB/secrets/assets and bounded OwnerBridge.
- Public /mcp tools/list exposes pantheon_health, pantheon_tasks, pantheon_command, pantheon_factory.
- Authenticated GO Brain search still works in this Work Mode room.
- Anonymous deployed GO command and PANTHEON intent both return HTTP 401.
- Real internal RPC created/read task_8c07788f9e194d77807e324da35d3d95.
- Factory training task_c56a8d23bda7413fbcec3734754f7da4 completed; readback receipt-482167aa-56f1-4c38-8713-8280b6c829cc matched, domainCompleted/domainVerified true, R2 training evidence returned.
- This real upstream test used a short-lived authenticated probe through the same PANTHEON OwnerBridge, not a ChatGPT pantheon_command call. The probe was deleted.
- Current room's exposed tool catalog still contains only Brain tools. Actual ChatGPT new-tool invocation remains pending catalogue refresh/reselection and a real call. Do not claim Android/Web acceptance until observed.

For future acceptance capture host/date, tool discovery, owner call, actual task ID, exact receipt/status/evidence, and negative authorization checks. If a tool is absent, state the host gap rather than filling it with remembered runtime evidence. Preserve unrelated builders/maps/mobile acceptance gaps.
