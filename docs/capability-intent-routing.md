# Ordinary-language PANTHEON outcome requests

Draft additive caller for the existing owner-only MCP registry. `pantheon_request`
accepts `{request, task_id?}` and forwards exact text to OwnerBridge's existing
`intent` operation. It performs no interpretation or permission grants in GO.
The paired PANTHEON receiver validates the proposal and existing action contract.

Examples: `show my tasks`, `show this task` with an existing task ID,
`what can you do?`, `build a click-counter website`. These are deliberately bounded
phrases, not arbitrary natural-language coverage. Unsupported results are returned
without creating a task, converting it to LOGIC, dispatching, or retrying effects.
`save this request as a text artifact` is only a plan, not execution.

Existing `pantheon_command` contracts remain explicit legacy operations. In
particular request-only `queue_factory` is LOGIC training, never a substitute for
an unsupported outcome. New consumers should use `pantheon_request` for ordinary
outcome proposals. Source text, including whitespace, is preserved.

No model, new service, secret, permission, deployment, or external connector change.
Receiver-first rollout requires separate approval; an older receiver refuses the
new payload rather than silently dispatching. No rollout is part of this PR.

Local validation: Node 24 test suite includes anonymous denial, extra-field and
identity validation, exact-text forwarding, and timeout/error without fallback.
The paired PANTHEON repository contains the cross-repository in-memory chain test
and the complete audit/GO acceptance handoff. Live acceptance remains GO's work;
do not rerun or alter the existing exact L1 task.
