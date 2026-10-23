# Factory R2 — GO direct command lane (WORK deliverable, 2026-10-23)

## Owner-approved operating route

BIG gives GO a business task. GO chooses the supported Factory capability and
submits its bounded specification through `factory_direct_submit`.
Factory creates its **own** durable Job ID and runs its registered machinery.
GO obtains Factory's actual Receipt, source-owned result bytes and evidence,
then hands them to BIG. PANTHEON remains a data exchange, task register and
historical receipt channel, but is not an obligatory GO command proxy.

`BIG -> GO Brain -> FACTORY_DIRECT -> Factory machinery -> Receipt/Artifact -> GO -> BIG`

**No Metropolis/City Work Pass, Work ID, Checkpoint ID, or caller-created
Factory Job ID is required on the GO command.** Factory derives a separate
internal scoped machine ticket after authenticating the GO signed rail; that
ticket exists only to retain compatibility with the original machine kernel,
not as a new external approval ceremony.

## Connected implementation in the paired repositories

**GO-Together PR #12** exposes:
- `factory_direct_status()`: private Service Binding health/registration and
  exact Factory source SHA (not proof of execution).
- `factory_direct_submit({domain,spec,requestId?,approved:true})`: one bounded
  authorized operation. GO generates a unique requestId if omitted; reuse the
  same requestId to reconcile an uncertain prior send. No Work Pass fields.
- `factory_direct_job_status({requestId})`: read-only Factory job/Receipt lookup,
  including an interrupted send. Never re-runs machinery.
- `factory_direct_readback({receiptId})`: signed, source-bound job receipt.
- `factory_direct_artifact({receiptId,artifactRef})`: read actual Factory file
  bytes (max 512KiB) and verify returned SHA-256, MIME and source SHA.

**Factory-District PR #43**:
- Independently authenticates GO using its own `GO_FACTORY_RAIL_SECRET` HMAC
  on an existing private Worker service-binding rail. The GO principal is
  distinct from CITY and PANTHEON and cannot use their credentials.
- `POST /station/go-job` accepts exactly `requestId`, `domain`, `spec`,
  `expectedSourceSha`. It rejects Work Pass, authority, injected machine
  scopes/IDs, unauthenticated calls and unsupported specifications.
- Factory deterministically derives an opaque `GOJOB-...` job identity from
  the requestId; this permits idempotent transport retries and prevents
  a duplicate machine effect. Reuse with changed instructions fails closed.
- Stores bounded CODE/VISUAL briefs immutably in existing Factory R2, then
  executes the existing bounded provider kernel. Receipts carry Job,
  Checkpoint, actor, source SHA, result references and evidence.
- `POST /station/go-job-status` recovers the job/Receipt state by requestId
  without replaying effects. Existing authenticated Receipt readback and
  a GO-owned Receipt-scoped artifact-bytes endpoint are reused.
- Legacy CITY/PANTHEON signed routes, secrets, D1 ledger, existing tasks,
  issued receipts and source of truth are unchanged.

## Supported production capabilities

| Domain | Actual bounded operation | Actual output |
| --- | --- | --- |
| CODE | Single Worker JS source, one exact patch, 1–8 HTTP assertions, isolated Dynamic Worker sandbox | Source `main.js`, Receipt, evidence |
| VISUAL | Static HTML card from title/body/accent and viewport; Browser rendering | `render.png`, Receipt, evidence |
| LOGIC | Place DWARF-01 into its training bench | Placement evidence + Receipt (no generic computation) |

Capabilities do **not** imply arbitrary Node/npm builds, public deployment,
generative image creation or general-purpose LOGIC calculations.
Failures must never be labelled as successfully produced artifacts.

## Authentication and safe release

The existing Cloudflare `go-together` and `factory-district` Workers contain
**different, intentionally inactive dummy** Secret Text values under the
name `GO_FACTORY_RAIL_SECRET`. Such strings are not valid HMAC configuration.
The checked-in GO Wrangler configuration declares private `FACTORY_DIRECT`
Service Binding to `factory-district`; this has NOT been activated in the live
GO Worker until the new code/config is deployed.

A live GO direct command will require BIG to replace both dummy slots with
the **same** fresh, secret 64-character hexadecimal string in Cloudflare.
Do not paste it into GitHub, chat, Brain, logs or request bodies. The legacy
PANTHEON/CITY keys remain separate; no migration copies them.

**Current WORK result:** paired feature source and native MCP interfaces are
implemented in PR #12 and PR #43. GitHub CI verifies build compatibility.
Both PRs remain reviewable but not merged/deployed. No user-facing live
Factory direct-job output has been claimed.

**Outside this WORK plan:** release/cutover, independent owner acceptance,
real-device/user TEST and DEBUG. These are a separate later phase; old
PANTHEON Factory commands are preserved until the new GO lane has been
safely installed and accepted. The data/receipt transfer role survives.
