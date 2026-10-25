# Private observer probe integration

Why: existing Factory `/station/key-probe` already validates recipient, expiry, scope and revocation without executing a job. Existing GO owner UI has no probe action. Use its existing private FACTORY_DIRECT binding; no new trust, public endpoint, Hub dependency or credential store.

This module/UI candidate requires the Hub owner to change only the existing `/api/factory-stamper` route:

- Add `key` and `scope` to `restrict(action, ...)`.
- Add `probe` to the permitted action list. Keep owner authentication, same-origin, JSON, intent header, 4096-byte limit and existing mutation approvals unchanged.
- Do not expose probe through unauthenticated MCP or Hub tools. Existing no-store response headers apply.

Probe accepts only action/key/recipient/scope; fixed private destination, no caller URL, no redirects or retries, five-second abort, bounded response and exact identity matching. UI sends only FACTORY:STATUS and captures recipient at issuance, never from subsequently editable fields. Only the existing one-time display holds the bearer; clear/hide/pagehide removes it, no storage or logging is added. Owner authorization and one in-flight UI action bound use; this is not a public token-validation service. Service-side explicit rejection returns only a boolean and bounded code; errors/unknown response fields never reflect upstream content. Issuance remains explicit and separately approved.

Alternative: a private external client would need a new authenticated ingress and secure credential handling that are not currently available. A browser public-Factory request would add CORS/access dependencies. Neither is needed.

Acceptance after parent-reviewed integration: synthetic UI -> GO owner route -> actual Factory; authenticated success, wrong recipient/scope, revoked token, cross-origin/unauthenticated denial, no Hub calls, no persistent token, no job execution. Live pilot remains pending exact approval for one GUEST_OBSERVER token, recipient ZONE3-ACCEPTANCE, FACTORY:STATUS only, TTL 300 seconds, followed by revoke and metadata readback. No APK signing key is involved.
