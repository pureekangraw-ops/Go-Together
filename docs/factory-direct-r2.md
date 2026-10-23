# Factory TEST & DEBUG R2 — GO-direct cutover (owner-approved 2026-10-23)

## Intent

BIG gives GO a work instruction. GO assesses the task, invokes Factory directly
for supported CODE / VISUAL / LOGIC machinery, receives a source-owned artifact
and receipt, checks and hands the output back to BIG. PANTHEON remains a data
transport/registry/evidence exchange; it is no longer the required execution
proxy once direct Factory acceptance is verified. Do **not** re-label existing
PANTHEON D1 `d1.create_text_artifact` actions as executable Factory domain jobs.

## Current slice (this draft PR)

- `FACTORY_DIRECT`: private Worker Service Binding GO Brain -> `factory-district`.
- `factory_direct_status`: owner-only read of the **exact** `/health` route
  over that binding. It reports identity, machinery registration and source SHA
  with an explicit `commandReady:false`. No PANTHEON hop, public API,
  generic URL, forwarded token, job creation or execution.
- The legacy PANTHEON OwnerBridge reads and command compatibility are
  **unchanged** in this first slice. Do not disable or delete in-flight jobs.
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
4. This does **not** make direct command execution operational by itself.
   Neither the transport client nor Factory's GO-principal signed-rail receiver
   is in this PR. When source changes are ready, deploy them as a matched pair,
   verify both current versions/bindings, then test authorized Work/Checkpoint.
5. Never overwrite `PANTHEON_FACTORY_RAIL_SECRET`,
   `METROPOLIS_FACTORY_RAIL_SECRET`, `FACTORY_PANTHEON_SECRET`,
   the PANTHEON owner binding, or existing record stores.

The new Binding name `FACTORY_DIRECT` appears in the repo config but is not
a live runtime Binding until this code/config is deployed. Production continues
using its current safe routes during the draft.

## Full direct executable contract (next WORK slice)

- Owner-authenticated GO Brain uses its actual actor identity and existing
  owner-authorized Work/Checkpoint provenance. Factory authenticates a
  *distinct* GO principal over the private Service Binding with a signed HMAC
  envelope and checks Work Pass, domain scope, immutable input refs and
  correlating actor/Work/checkpoint before any effect.
- `factory_direct_preflight` is read-only;
  `factory_direct_execute` is a deliberate owner-authorized command;
  `factory_direct_readback` returns exact receipt/artifact refs/sourceSHA.
  No unsigned execution, URL-proxying or fake Work Pass.
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
