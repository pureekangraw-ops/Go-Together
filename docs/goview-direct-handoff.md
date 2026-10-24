# GO Brain map delivery adapter

Companion Observatory PR 246 provides `GoviewGoBridge.invoke` reusing the existing versioned package PUT/GET storage contract. This branch registers `goview_publish` and `goview_readback` behind existing owner OAuth. Inputs include mapId, exact version, transferId and expected full SHA-256; publish additionally accepts the package string. No arbitrary URL/header/credential forwarding or map listing.

Runtime activation is NOT performed. A separately authorized GOVIEW_GO named service binding must target service goview-package-bridge, entrypoint GoviewGoBridge. Until then tools return GOVIEW_BINDING_NOT_CONFIGURED. Existing Observatory and Brain identity/auth/storage remain unchanged. Required map Worker/R2 and its separate role secrets require specific authorization; no credentials belong in this source.

Readback success proves remote exact artifact bytes only. Android still previews and requires owner approval, then writes its own durable full-digest receipt. Owner may inspect/export that receipt explicitly. Never call this physical handset acceptance or infer permission to retrieve GPS/history. After an uncertain publish, read exact version/hash before deciding whether to retry.

Local tests: node --test tests/*.test.mjs (84 passing at implementation). Live runtime and handset transfer are pending activation and acceptance.
