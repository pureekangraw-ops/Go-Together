# GO owner tooling — Factory Zone 2 paired source (27 Oct 2026)

Paired Factory PR60. **DRAFT, NO PRODUCTION DEPLOY**.

- `factory_direct_submit` uses the existing owner-approved signed Factory HMAC rail. `domain=PROOF`, `spec.mode=TOOLKIT`, `spec.action=OPEN_ENV|ENV_STATUS|CLOSE_ENV|REGISTER_CASE|RUN_CASE|READ_RUN|...`. Factory enforces project, exact source SHA, run kind and TTL; GO never provisions a new Worker/Queue/Hub staging path.
- `factory_job_stamp_status({receiptId})` reads existing GO-owned Job Stamp metadata, not credentials, and does not execute machinery or mark actual recipient delivery. Only Factory validates and stamps completed machine outputs.
- PROOF `appAcceptanceVerified:false` remains mandatory even if the managed RUN_CASE executor actually ran. In that case `externalTestExecuted:true` must be supported by a Factory Toolkit runner result; catalog/readback-only commands remain false.
- `CODE`, `VISUAL`, `LOGIC` and legacy Factory file delivery keep their existing command shapes. Key Stamper still issues scoped credentials separately and is not reused as a Job Stamp.
- GO PR30 source is the unchanged base; this PR only adds owner MCP surface for Zone 2. Hub V2 does not become an executor. No extra secrets, APIs, cloud resources, binding changes or owner approvals are granted here.
- Zone 3 later: pair source SHA with current deployed GO and Factory release candidates, test actual Cloudflare Browser/Queue and file reception. Approval to build Zone 2 does not mean the cloud path already passed.
