# GO → Hub V2 RPC repair evidence

Status: review candidate only. Production is unchanged.

## Root cause

Cloudflare read-only API inspection on 2026-10-27 established:

| Worker | Active version | Runtime contract |
| --- | --- | --- |
| go-together | V55 `c3ca46b3-ac3c-4061-9bfb-14b5a0396596` | Default `fetch`; named `AppTools.fetch` |
| ygg-connection-hub-v2 | V21 `9f631634-e9dd-4682-bf10-ccafe3d79819` | Default `fetch`; named `HubBridge.connections`, `refresh`, `catalog`, `relay` |

Read endpoints: `GET /accounts/{account}/workers/scripts/{worker}/settings`, `/deployments`, and `/versions/{version}`. Both settings and the active GO version resources show `HUB_V2` targeting `ygg-connection-hub-v2` **without an entrypoint**. The Hub's `GO_APPS` reverse binding correctly targets `go-together` / `AppTools`.

GO source `5de2c4f1dd17a3955c898ebb7dce91a43ba50e8d`:

- `worker/index.js`: authenticated public MCP routes Brain/Factory names through `hubTool`; `hub_connections` uses `hubConnections`.
- `worker/hub-client.mjs`: calls `env.HUB_V2.relay(...)` and `.connections()` respectively. No retry/fallback is needed or added.
- `wrangler.jsonc`: already declares `HUB_V2` / `ygg-connection-hub-v2` / `HubBridge` correctly.
- `worker/hub-entry.mjs`: existing private `AppTools.fetch` dispatches app MCP locally, avoiding recursion. Factory status uses the existing `FACTORY_DIRECT` rail.

GitLab `pureekangraw/hubstation`, source `4b2542a10ec94be7dc5ea07b6ac8f8ad6dafa8b8`:

- `src/entry.js` exports all four methods on `HubBridge`, matching the active Hub version's named handlers.
- `src/private.js` resolves the managed connector and relays via the existing source MCP and service binding, retaining schema checks and delivery journal behavior.

Factory `src/worker.mjs` was read through its canonical GitHub connector. Its existing GET `/health` path returns Factory identity/machinery state. GO's `factoryDirectStatus` uses that path and the existing optional signed auth probe; neither submits a job.

The receiver selected by the live GO binding is the Hub **default export**, which only supports `fetch`, explaining both reported missing-method errors. This is deployed service binding drift, not a need to rename RPC methods or change the ChatGPT connector. The API deployment metadata says `source: api`; the uploader that omitted entrypoints is not present in the inspected GO release scripts, so its exact implementation is not proven. Source SHA equality with the entire deployed bundles is not claimed.

## Reviewable correction

`hub-v2-rpc-binding-repair.json` records before/after values. The root correction is to retain `entrypoint: HubBridge` on the existing `HUB_V2` API binding. It creates no resources or paths. The same GO version also omitted the configured names on `OBSERVATORY_GO` and `GOVIEW_GO`; the artifact records their source-declared names to preserve those original capabilities. Their live receiver contracts were not independently verified in this task and must be checked before applying those two ancillary corrections.

Apply changes to the **fresh complete metadata**, by binding name and exact service, only during a separately authorized production release. Do not upload this repair description as Cloudflare metadata or replace the complete bindings list with it. Preserve secrets, D1, assets, variables, all other metadata and current source. If the active version or before values differ, reconcile the new state first. Do not roll back or deploy this repository wholesale merely to fix one binding.

The existing `scripts/assert-current-routing.mjs` now optionally checks API-shaped bindings, so a release can validate the actual upload metadata and independent version readback, not just Wrangler source:

```sh
node scripts/assert-current-routing.mjs
node scripts/assert-current-routing.mjs /path/to/metadata.json
```

The optional file must contain `{ "bindings": [...] }` (upload metadata or version `resources`). This command is read-only; it does not deploy. It checks all four existing service destinations and named entrypoints. Keep the existing release validation step and pass the actual metadata to it. No new runtime gate is introduced. No change to GO/Hub/Factory business logic, authentication, authorization, storage, tool catalogs, request identity or UNKNOWN handling.

## Test evidence

- Before validator repair: the regression failed with `Missing expected exception` when API metadata omitted `HUB_V2.entrypoint`, demonstrating that the old checker ignored deployment metadata.
- After repair: four targeted tests passed. The repair fixture preserves every other binding field, secrets and D1 descriptors; missing/wrong named entrypoints are rejected.
- `node --test --test-isolation=none tests/*.test.mjs`: **156 passed, 0 failed, 0 skipped**, one full local confirmation run. Existing OAuth, Brain, provider, Factory approval and delivery tests are included.
- New local test exercises the real GO public MCP dispatcher, Hub client and private app MCP dispatcher with a **mock Hub contract and mock Factory health endpoint**. Unauthorized access is rejected before calls; Brain context returns its existing evidence pack; Factory status returns a Hub receipt; the only Factory request is GET `/health`; connection inventory calls `.connections()`.
- This does not prove live Hub storage/relay, workerd RPC transport or production end-to-end success. The optional dependency installation for additional workerd testing did not finish and was cancelled; no such test success is claimed.

## Remaining production proof

No merge/deploy is authorized by this task. After an independently approved metadata repair, read back the exact active GO version's binding entrypoint and Hub's named handlers, then perform owner-authenticated read-only `brain_context`, `factory_direct_status`, `hub_connections` once. Preserve and inspect existing UNKNOWN receipts; never replay them. Catalog/schema approval state may present a separate later failure once RPC reaches the receiver; it has not been tested or changed here. No real Factory job is needed for this proof.

Cost: no paid AI API, live Factory job, resource creation or new paid service. Only source/metadata reads and local tests were used. PR creation may trigger the repository's existing CI once; no repeated CI run is requested.
