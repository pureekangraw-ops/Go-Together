# Canonical deployment target — 2026-11-20

Cloudflare readback: go-together active version d717edf3-7a54-464e-90b5-c117cd8081e4, 100%; BRAIN_AUTH_MODE=ACCESS; DB=6f68d68b-df46-4c44-8c65-7491a1a2f17b. This is standalone Brain, not the historical Hub service.

Use `wrangler.brain.jsonc`. Both Wrangler configs have a mandatory custom-build preflight; the old default Hub config now fails before upload. Historical paired-release tooling also checks live infrastructure and cannot legitimately deploy its old DB configuration over Brain. Do not remove these checks to run that workflow. A future Hub release needs its own reviewed Worker target.

Run `node scripts/deployment-preflight.mjs brain` and the full Node tests before any release. This preflight protects checked-in Wrangler workflows, not someone manually bypassing configuration or calling the provider API. It does not attest source parity with the latest production module bytes. No deployment was performed for this audit fix.
