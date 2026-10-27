# VISUAL and LOGIC: finish delivery on the original Factory job line

Scope: existing owner-approved `factory_direct_submit` remains the only new-job intake. No new Hub, Worker, Queue, secret or endpoint.

The already deployed Factory machine builds the artefact and records a signed owner Receipt. Synchronous VISUAL image and LOGIC workshop EXPORT_PACKAGE already return artifacts from `factory_direct_submit` where completion is immediate. The missing user-facing segment was **read-only recovery** after any uncertain response, and VISUAL Queue final delivery if a future approved Queue consumer completes.

This patch extends the EXISTING `factory_direct_job_status({requestId})` read path:
- After a verified completed VISUAL receipt, locate exactly one owner receipt-scoped render.png or split-manifest.json, independently fetch and hash the actual stored file using the existing signed go-artifact endpoint; include a `delivery` object. A static PNG returns base64 image bytes, while the image pack returns its bounded verified files and ZIP reference/digest, not pretend that multi-MiB ZIP bytes were inlined.
- After verified LOGIC completion, return the existing workshop result; when the operation is EXPORT_PACKAGE, fetch the exact authorized package JSON bytes using the existing receipt-bound, SHA-256 verified artifact route. Plain DWARF trainee placement remains a placement receipt, not a completed model training claim.
- Missing, contradictory, unverified or oversized artifacts produce a clear `delivery.status` indicating not yet delivered. Status lookup **never submits the machine again**, retries an unknown effect, or promotes a late Queue receipt into a timely success.
- No difference to CODE, PROOF, normal direct-submission payloads, HUB V2 or Owner authority. The status tool remains read-only. Existing VISUAL 5-minute Queue gate/consumer is separate and dormant, and its activation requires owner-approved resources and hosted acceptance; source readiness cannot be reported as a live 5-minute guarantee.

A single owner **job command** can therefore produce a real VISUAL/LOGIC result through Factory; subsequent read-only status/recovery can show the artifact directly without the owner issuing a second job command or manually assembling refs. True proactive completion notifications / automatic 5-minute rendering without a later read are NOT supplied by this patch, and require an existing authorized delivery/notification owner.

Source tests cover PNG and Workshop package exact bytes, split ZIP digest references, normal LOGIC completion, pending/unknown fail-closed, and no /station/go-job effect on status calls. A source CI pass does not prove hosted VISUAL Queue or current Production E2E.
