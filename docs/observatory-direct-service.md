# GO Brain ⇄ Observatory direct connection

GO keeps the existing GO Brain App binding and OAuth. New `OBSERVATORY_GO` named Cloudflare Service Binding points to `observatory-shared-browser` → `ObservatoryGoBridge`. No new ChatGPT plugin, account identity, D1 database or duplicated bearer secrets.

The GO Brain source exports seven MCP tools: observatory_session, observatory_observe, observatory_screenshot, observatory_action, observatory_run, observatory_job and observatory_note. All calls go through the existing owner OAuth gate and the callee hardcodes role=GO. The Observatory Durable Object enforces exact-host invitation, controller lease, selectors and bounded job receipts. Anonymous GO Brain sessions cannot access this binding.

Deploy the Observatory Worker named entrypoint first, then GO Brain binding second, preserving existing source/bindings and authenticated owner data. Readback session should show LOCKED without BIG invitation. BIG invites GO from APK; only then may GO read the shared page. Distinguish this live browser from the old 30-second pantheon_observatory snapshot tool.
