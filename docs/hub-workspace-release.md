# Hub-local Workspace integration candidate

Why: GO Workspace PR19 advertises google_workspace_read/receipt/write, but deployed Hub source 616e1f0 exposes only google_status and has no Provider Worker binding. Deploying PR409 alone cannot complete that route.

This branch normally merges GO22 d9eb7ef4ea06f758f05b3edbb1e2ca6e0a96a4d8, Workspace19 4dfc0a059ac8f18b8db9b3e90fcca2112e902f74, and latest Stamper21 7b42c8a469f2d4c2e799f8ef5afc8cb3decae9ee. Main inspected: 58c2b58832ab665a7ce44d47291cacd87ae75f6a. No main merge. Factory/Stamper modules/UI are inherited unchanged from their owner's branch. Browser and Factory routes, owner authentication, AppTools and existing service bindings remain.

Route contract: Workspace and provider commands use HUB_V2 -> packaged local Google in existing Hub. Existing grouped applications retain Hub -> GO AppTools -> application binding. GO22's three typed GOVIEW commands retain their original direct GOVIEW_GO route and byte limits after owner authentication; they are still advertised by AppTools for discovery. No transport retry or credential forwarding is added. Workspace request IDs stay in payload; each delivery gets a fresh Hub message ID so receipt polls and source-level deduplication remain useful.

Paired Hub source: room2/workspace-local-routing-20261025 in pureekangraw/hubstation, based on ec7ff79 (documentation after deployed 616e1f0). Its release packet and pinned paired tests are authoritative for integration evidence. Do not deploy older GitLab main a6ce7ce5 or the legacy provider draft as this solution.

Validation: full GO test suite plus actual GO+Hub source catalog/chain tests and bundled workerd/D1 tests, all with synthetic Google HTTP. The optional GOVIEW external fixture is separately selected with GOVIEW_CONTRACT_ROOT; a skip is not a pass. No device, production Drive, actual key issuance, or release claim.

Release requires parent independent review of exact combined pins, current live settings/versions readback and explicit activation authorization. Preserve existing bindings, secrets, assets and data. Hub owns the one-work WORKSPACE_CONTINUITY_CONFIG; it is intentionally absent from source settings. No new Worker, binding, key, OAuth scope, IAM expansion or automatic pilot. No runtime changes made by this branch.
