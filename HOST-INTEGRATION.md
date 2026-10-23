# factory-status-report/v1 — reusable host integration contract

This optional adapter injects the existing reporter into a selected host. It is not a registered tool, deployment, new transport, credential loader, or authorization mechanism. The reporter stays byte-identical: 13,546 bytes, SHA-256 `68210ffa4dfcbd41b64740573c8a64476065257e40449decaf0b75691c13b8af` (function text without trailing newline/export).

| Explicit host | Required host-local capabilities |
|---|---|
| `codex_apps` | `mcp__codex_apps__go_brain_pantheon_factory`, `mcp__codex_apps__go_brain_pantheon_tasks` |
| `go_brain` | `mcp__GO_Brain__pantheon_factory`, `mcp__GO_Brain__pantheon_tasks` |

Select exactly one host. Both capabilities must be own callable properties of the explicitly supplied object. Missing capabilities fail before any call. The fixed codex_apps keys inside the reporter are **internal adapter labels**, including in its evidence; they do not prove remote tool registration. Keep the adapter's `host` and `requiredCapabilities` beside a report when attributing actual host capabilities.

Construction contract: `createFactoryReportIntegration({ reporterFactory: createFactoryReport, host, connectors, clock? })`. Returned fields: `contract`, `host`, `requiredCapabilities`, `registeredTool:false`, and `report(options)`. The report keeps the original 1–3 unique explicit IDs, default dry run, max 1+2N reads, per-invocation deduplication, no automatic retries, and same-instance Retry-After hold. Keep one integration instance for deliberate refreshes so cooldown state is retained. The adapter never discovers another host or retries an alias.

## Injection recipe — dry run only

After loading the exact reporter and adapter through the host's supported local module/snippet mechanism:

```js
const integration = createFactoryReportIntegration({
  reporterFactory: createFactoryReport,
  host: 'go_brain',
  connectors: {
    mcp__GO_Brain__pantheon_factory: typeof tools.mcp__GO_Brain__pantheon_factory === 'function'
      ? args => tools.mcp__GO_Brain__pantheon_factory(args) : undefined,
    mcp__GO_Brain__pantheon_tasks: typeof tools.mcp__GO_Brain__pantheon_tasks === 'function'
      ? args => tools.mcp__GO_Brain__pantheon_tasks(args) : undefined
  }
});
const result = await integration.report({ taskIds: [explicitAuthorizedTaskId] });
```

This performs no connector reads. For the other host, explicitly select `codex_apps` and inject only its two listed functions. Do not switch hosts in response to a denial. Native module users import the two factories from their .mjs files; snippet hosts must use literal reviewed function declarations and omit ESM export declarations, not eval source strings.

## Current GO blocker and normal setup

GO received and hash-verified the final reporter and passed four offline assertions, as reported by the parent. Its real Factory(task_id) read was BLOCKED by host safety. Exact sanitized denial and the supported approval route are pending from GO. This adapter does not resolve that block. Do not perform the blocked read through another tool, alias, or host.

Normal setup requires the host's existing integration owner to expose the two authorized local read capabilities, load this reviewed reporter/adapter through its supported reusable module or snippet mechanism, and resolve the actual safety block through the host's documented approval route. A callable capability alone does not establish permission. No permission, credential, registration, or deployment changes are made here. Since the precise denial is pending, no approval procedure or required permission is guessed. If the host has no supported reusable module/snippet mechanism, consumer integration remains unavailable; do not invent a registered reporter.

The tests use only local synthetic connectors, including both naming schemes, missing capability, deliberate repeat invocation, and auth refusal with no alias fallback. They do not simulate or clear the real GO safety decision. The parent's earlier functions.exec read-only historical-L1 verification remains version/host-specific. GO consumer B2E is BLOCKED; overall cross-host B2E is not complete. No new live calls were made for this patch.

Run offline: `node --test tests/factory-integration.test.mjs`. This additive patch does not replace the published version-1 ZIP or its manifest; regenerate a release manifest only when this integration patch is intentionally incorporated into a later package.

Offline validation in the recovery container: 8 tests passed, 0 failed, 0 skipped. Reporter function byte/hash assertion passed.
