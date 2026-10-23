# Factory TEST & DEBUG R2 — GO-direct cutover (owner-approved 2026-10-23)

## Intent

BIG gives GO a work instruction. GO assesses the task, invokes Factory directly
for supported CODE / VISUAL / LOGIC machinery, receives a source-owned artifact
and receipt, checks and hands the output back to BIG. PANTHEON remains a data
transport/registry/evidence exchange; it is no longer the required execution
proxy once direct Factory acceptance is verified. Do **not** re-label existing
PANTHEON D1 `d1.create_text_artifact` actions as executable Factory domain jobs.

## Current GO-side implementation (this draft PR)

- `FACTORY_DIRECT`: private Worker Service Binding GO Brain -> `factory-district`.
- `factory_direct_status`: owner-only read of the **exact** `/health` route
  over that binding. It reports identity, machinery registration and source SHA
  with an explicit `commandReady:false`. No PANTHEON hop, public API,
  generic URL, forwarded token, job creation or execution.
- `factory_direct_preflight`, `factory_direct_execute`, `factory_direct_readback`:
  HMAC-signed Work Pass preflight, explicitly owner-approved execution, exact
  source- and actor-correlated receipt retrieval. The caller must supply a real
  existing GO-owned Work Pass; the tool does not mint one.
- `factory_direct_artifact`: requests bytes only from an exact authorized GO
  receipt, verifies SHA256 of returned data and the Factory source identity,
  and returns MIME + base64 for files up to 512KiB.
- Matching Factory-side direct principal, Work Pass validation and a private
  signed artifact route are in **Factory-District Draft PR #43**. The paired
  source changes are not yet deployed to live Workers.
- Legacy PANTHEON OwnerBridge reads and commands remain **unchanged**. Do not
  delete its in-flight or completed historical jobs.
- A successful `factory_direct_status` is not a completed CODE/VISUAL/LOGIC job.

## Cloudflare setup (2026-10-23)

Both live Workers have a new, separate Secret Text slot,
`GO_FACTORY_RAIL_SECRET`. GO's and Factory's placeholder values are
**different** and intentionally not usable for authentication; legacy keys
were not copied or overwritten.

1. BIG generates one fresh unpredictable **64-character hexadecimal string**.
2. BIG replaces `GO_FACTORY_RAIL_SECRET` with that **same** value under
   **go-together** and **factory-district** > Settings > Variables and Secrets.
3. Do not paste the value into chat, GitHub, Brain, a Work pass, or an artifact.
4. This does **not** make live direct execution operational by itself. GO
   signed transport and Factory GO-principal receiver have been implemented in
   **paired Draft PR #12 and #43**, but neither has been deployed. They must be
   deployed in a coordinated order after reviewing the current bindings,
   adding one matching real secret, and obtaining a genuine scoped Work Pass.
5. Never overwrite `PANTHEON_FACTORY_RAIL_SECRET`,
   `METROPOLIS_FACTORY_RAIL_SECRET`, `FACTORY_PANTHEON_SECRET`,
   the PANTHEON owner binding, or existing record stores.

The new Binding name `FACTORY_DIRECT` appears in the repo config but is not
a live runtime Binding until this code/config is deployed. Production continues
using its current safe routes during the draft.

## Direct executable contract (implemented in paired drafts; live acceptance pending)

- Owner-authenticated GO Brain uses its actual actor identity and existing
  owner-authorized Work/Checkpoint provenance. Factory authenticates a
  *distinct* GO principal over the private Service Binding with a signed HMAC
  envelope and checks Work Pass, domain scope, immutable input refs and
  correlating actor/Work/checkpoint before any effect.
- `factory_direct_preflight` is read-only;
  `factory_direct_execute` is a deliberate owner-authorized command;
  `factory_direct_readback` returns exact receipt/artifact refs/sourceSHA;
  `factory_direct_artifact` reads and verifies actual bytes. No unsigned
  execution, URL-proxying or fake Work Pass.
- CODE is currently the bounded edge JS Worker patch/test/deploy-in-sandbox
  capability with scope `EXECUTE:CODE` + `DEPLOY:CODE`.
  VISUAL is bounded static HTML-to-PNG `EXECUTE:VISUAL`.
  LOGIC currently has a real trainee placement path, not a general arithmetic
  computation machine. Register genuinely supported capabilities only.
- Existing task identities CODE/VISUAL/LOGIC that got `UNSUPPORTED 422`
  and `Factory job not found 404` are preserved. A new direct Work may be
  created only through the actual owner Work system—not by mutating action
  identity on those historical tasks.
- Primary acceptance is a generated artifact opened and read by GO, matching
  source-owned digest + durable receipt and repeat read without repeat execution.
  PANTHEON remains for data transfer and historical receipts. Retire its active
  Factory dispatch as a *default* only after end-to-end GO-direct acceptance.

## Evidence baseline

- PANTHEON current legacy queue of existing CODE/VISUAL/LOGIC requests:
  authenticated 422, task state unchanged; exact Factory job read 404.
- New isolated LOGIC trainee acceptance task
  `task_ecc159fe0841476481782002f4dc6692`:
  dispatch COMPLETED, owner receipt
  `receipt-d9c237ec-1bf3-4d4f-9296-823af4dbb494`,
  authenticated stable repeated readback, status PLACED_FOR_TRAINING.
  This is **not** arithmetic output or CODE/VISUAL artifact delivery.
- Factory CODE/VISUAL provider bindings are present in Cloudflare,
  but machine health READY is registration, not proof of a production job.

No merge, production source deployment or direct Factory job has been caused
by this draft.

## Remaining product work / owner acceptance

1. Connect GO to the legitimate Work/Checkpoint/Work Pass issuer and actual
   production inputRefs. The two draft Workers currently **require** an existing
   active GO Work Pass rather than fabricating one from a PANTHEON D1 task.
2. With BIG's matching real secret in both existing Cloudflare slots, deploy
   Factory PR #43 and GO PR #12 as a compatible pair (preserve the current
   source identities, secrets, storage and bindings). Source-key placeholders
   remain inactive until replacement. Do not merge just to get a green check.
3. Invoke a real bounded CODE and VISUAL job via GO, retrieve JS/PNG bytes,
   check digest and actual usability, and repeat readback without rerunning.
   LOGIC arithmetic requires a separate real LOGIC computation runner; the
   present LOGIC capability is only training-bench placement.
4. After actual GO job and artifact acceptance, shift the normal command path
   away from PANTHEON while keeping its metadata, receipts and data transport.

Paired CI on both draft heads uses synthetic 64-hex keys and fake machine
providers. Green CI verifies the protocol modules and receipt checks, not a
live owner credential or production artifacts.
