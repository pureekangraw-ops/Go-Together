# Connected candidates — source acceptance

This GO candidate combines provider PR25, typed Observatory PR26 and Factory recovery PR27. Main and production are unchanged.

## Producer dependencies

- Observatory PR264: `d4a9bbc5a33e645270eb7b47d3c0bdf47d95c245`. CI checks out this exact commit; typed transfer contract source is exercised by GO tests. Mobile release0.7.5/code21 unsigned APK SHA256 `cb8815470f5b993c4d28026405e73d95c46e2f7ea5616486c7549c2179d34fa6`.
- Factory PR53: `524c9210265bd659a232fd4031c3a7cfb49ec828` updates active APK acceptance without replacing historical0.7.4 evidence. PR55 remains separate VISUAL lifetime/temporary-resource work; UNKNOWN jobs must not be resubmitted.
- Greenhouse PR22: `ed5f8ce9903e8328c0327c3ae945b4c5affb8ebc`. Private named `GreenhouseRead` entrypoint, JSON-RPC `/mcp`, service binding capability plus explicit station-read declaration. No deployment permission is inferred from this source packet.
- Office PR91: `dffe214353d9d5e9580559a881866a8ea3d65bed`. Exact build artifact12654262988/run40330551124, ZIP SHA256 `7a09a2ee82a01dc15126ca5d8944258b34fec3d3dac69d3adeaca6d9b30ccd25`. Existing PR90 release verifier rejects these different bytes. Existing Office entry is `/admin/storefront`, dedicated token with independent READ/EDIT/PUBLISH grants; no cross-origin bypass or new API invented.
- Hub MR5 must accept typed `goview_transfer_read` and `goview_transfer_publish` responses through its trusted GO_APPS private route up to4,227,072 actual UTF8 bytes. Generic tools, legacy commands, receipt and discovery retain1MiB.

## Greenhouse read routing

GO owner authentication remains unchanged. Only `greenhouse_delivery_list`, `greenhouse_delivery_get`, and `greenhouse_result_get` are exposed. GO relays to connector `greenhouse`; it neither calls Greenhouse directly nor installs a binding or grant. Arguments reject extra ownership/execution fields. Missing Hub connector/grant is an unavailable integration, never a reason to fall back to a public endpoint.

Responses retain `scope.kind=STATION`, incomplete recent-window coverage, `workRef.resolution=UNRESOLVED`, NOT_FOUND and UNAVAILABLE. Station delivery evidence cannot authorize a Work, signal domain completion, or trigger a second scheduler. Repeated reads use fresh relay message IDs; mutation dedup identities remain stable.

## Evidence and release boundaries

Local GO suite109/109 passed without skips using exact Observatory source. Worker Wrangler dry-run passed with existing bindings only. Independent merge review found no code blocker; its CI pin finding was corrected. Local protocol/source tests are not hosted production or physical-device acceptance.

Before live use: review exact resulting heads; prepare explicit binding/grant and runtime catalog activation; authorize release separately; perform hosted destination readback, mobile signature/update/data retention acceptance and Factory duration/cleanup proof. Do not reuse an older approval, overwrite newer GO deployment or replay an UNKNOWN request. Slack is excluded from this integration work.

## Isolated VISUAL Queue wire contract

The optional Factory-owned queue uses the existing signed GO admission/status routes only after their existing HMAC/source/input validation. It is gated by explicit isolated-test activation and private queue binding; no production configuration is installed by this source change. Default routes continue synchronous execution.

An authenticated queue response declares `executor=FACTORY_VISUAL_QUEUE_V1`, `domain=VISUAL`, exact request/job/source identity, `admittedAt`, and `deadlineAt=admittedAt+300000` (safe integer epoch milliseconds). GO reports ACCEPTED as `VISUAL_JOB_ACCEPTED`, `verified=false`, `executed=false` and no invented receipt. Read-only polls return ACCEPTED/IN_PROGRESS/UNKNOWN without consulting a possibly late raw Receipt. All reads retain fresh relay IDs.

COMPLETED/FAILED require `admittedAt <= receiptObservedAt <= settledAt <= deadlineAt`, plus independent receipt readback matching job, source, exact observed timestamp and outcome. Completed receipts additionally match VISUAL. Duplicate queued submissions require read-only status reconciliation and cannot enter the synchronous completion path. Unknown executor versions, malformed metadata, missing/late settlement or mismatched receipts fail closed. A late raw completed receipt cannot override Queue UNKNOWN.

GO tests117/117 pass against exact Observatory source. Factory actual configured machinery and signed-route integration uses synthetic render providers; this does not prove real hosted PNG output, hard cancellation, quota, deployment, or five-minute Cloudflare lifetime. Renderer hard cancellation and per-step deadline reservation remain unsupported; activation requires explicit review and hosted acceptance.

## Exact Hub receipt reconciliation

`hub_delivery_receipt({connectorId,messageId})` uses the existing owner-authenticated GO MCP gate and trusted private HubBridge receipt capability. It performs one exact managed-connector read, without relay, discovery, refresh, synchronization or retry. Missing and cross-connector rows remain indistinguishable NOT_FOUND. Transport UNKNOWN is not domain failure or Work completion; taskSuccess remains null. The ledger has no per-caller ownership column, so this feature must not be described as multi-tenant authorization.

Greenhouse source errors retain only READ_ARGUMENTS_INVALID, READ_NOT_AUTHORIZED, READER_UNAVAILABLE or SOURCE_READBACK_REJECTED plus the original Hub receipt. Malformed JSON/non-object values preserve the receipt as INVALID_HUB_RESPONSE; arbitrary private error text is omitted. If relay itself throws before returning a receipt, the result provides only DELIVERY_UNCERTAIN and the exact generated receiptLookup identity, without fabricating a receipt or replaying the operation.

## Credential-free source candidate build

The source-candidate CI job checks out the exact PR head without persisting checkout credentials, installs pinned Wrangler4.152.0 into a separate temporary toolchain, and runs dry-run only. It exports the module with its exact producer SHA, tracked static assets, source configuration with only the entry path made portable, resolved toolchain lock and per-file SHA256 sums. An empty output directory and clean tracked build inputs are required. The native artifact is explicitly a source candidate, not release authorization. No provider credentials are passed and no deployment is performed.
