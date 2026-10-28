# Sustainable release route

Owner direction: change the route if legacy preservation makes it impractical; prefer a maintainable system.

- [x] One protected GitHub deployment job; GitLab supplies immutable source only.
- [x] One approved manifest read from GO main; historical receipts recover independently of current main.
- [x] Separate reviewed current infrastructure from hashed runtime/static payload bundles.
- [x] Restore approved earlier payloads by republishing with current bindings/config into new versions.
- [x] Direct bounded GO OIDC readback permits GO-first commissioning before Hub has the new controller.
- [x] Final private RPC, first-install receipt adoption, durable artifact correlation and no-replay guarantees.
- [x] Real-process provider-boundary tests plus real-signature/SQLite regression coverage.
- [ ] Commission approved source/fallback and one-time runner settings; prove ordinary-room and production acceptance.

Spec and setup: docs/go-manual-assets-deploy.md. No production/permission/secret change is authorized merely by committing this plan. The owner's request authorizes implementation and reviewable delivery of the replacement route.
