# GO → Factory VISUAL alpha pack tool integration

This document accompanies Factory-District Draft PR #49 and GO-Together Draft PR #20. Both source branches are unmerged and existing production tools still expose only the old STATIC_CARD_PNG capability.

## Two separate owner-authorized operations

1. `factory_visual_upload({pngBase64,sha256,requestId?,approved:true})` signs an authenticated owner request on the existing GO->Factory rail. It verifies exact source bytes, persists immutable PNG in R2 and rereads its SHA. A successful response is `STORED_NOT_PROCESSED` and `executed:false`.
2. `factory_direct_submit({domain:'VISUAL',spec:{imageSplit:{sourceRef,count,columns,canvas,names}},approved:true})` requests actual processing only after upload. The Factory-generated job ID, PIXIE runner, manifest, all image refs, ZIP ref and Receipt must match. Only successful final artifact/receipt readback produces `GO_FACTORY_IMAGE_PACK_READY`.

`factory_visual_upload_status({requestId})` is a read-only recovery; reuses existing request identity and never resubmits upload.

`factory_visual_zip_chunk({receiptId,artifactRef,offset,length?,expectedSha256})` returns a bounded <=256KiB verified ZIP segment. Caller checks source manifest's full ZIP SHA, assembles chunks in order from offset 0, verifies the final combined length/hash and stops. No giant ZIP is returned in one MCP response.

## Boundaries

- No new secret: the existing GO_FACTORY_RAIL_SECRET remains the only GO->Factory signing authority and is never returned to the MCP caller.
- The new large-MCP-body allowance is limited to owner-authorized factory_visual_upload calls; ordinary MCP calls still have the 1MiB logical payload ceiling.
- Source is RGBA8 PNG only, <=4MiB compressed; the Worker-native renderer accepts bounded dimensions and refuses ambiguous components.
- Existing CODE, LOGIC, Workshop and static-card VISUAL tools are unchanged.
- UI-ready source does not mean server deployment. New tools require a paired Factory deployment and GO catalog refresh. Until then live GO factory_direct_status still reports STATIC_CARD_PNG.

## Evidence

Factory PR #49 signed local R2-shaped end-to-end tests and original standalone cutout source tests have passed GitHub CI. GO PR #20 MCP tool authorization, SHA validation, upload status, receipt-linked manifest, ZIP chunk checks and regressions have passed GitHub CI. Cloudflare isolated staging and owner artwork runtime tests remain.
