# Factory Workshop adapter continuation

Adds owner-approved `factory_workshop_content` and LOGIC
`factory_direct_submit({spec:{workshop:command},approved:true,requestId})` to the
existing signed private Factory rail. Existing tools handle status, reconciliation,
receipt readback and package bytes. Content and package hashes are independently
verified. Generic Workshop writes are refused against old Factory health without
`genericRunner.status: READY`. Tool presence/readiness is not execution proof.

Commands and immutable refs follow Factory LOGIC Workshop Blueprint v0.1. Supported
execution in the paired Factory candidate is RULE_AGENT_V1 (literal-rule advisory
classification, no model inference) and PIPELINE_RUNNER_V1 (bounded ADD/MULTIPLY).
OWNER_QUALIFY requires an explicit decision/reference plus owner-approved submit;
failed qualification/export never becomes placement success. Actual Workshop
results are returned separately from machine completion.

Local validation: GO suite 103/103 PASS, including owner-only tool discovery,
explicit approval, extra-field rejection, old-runtime fail-closed and content hash
mismatch. Factory's paired offline script exercises both actual client flows:
14 operations each, failed baseline, RCA/candidate, comparison, approval/rejection,
blocked old approval export, new approval, package/readback and request reconciliation.
Those are synthetic local tests, not production B2E.

Only Factory dispatch/import/tool registration in worker/index.js changes. No
Observatory/GOVIEW bindings or implementation, auth credentials, assets, provider
subscriptions or deployment settings change. Existing owner authorization applies.

Review both candidates before release. GO can deploy first and refuses Workshop
writes until Factory is available. Factory's existing main workflow deploys its
existing provider Worker first, then Factory. Record current rollback versions and
preserve all live GO bindings/assets before activation. No merge/deploy/live jobs
are performed by this PR.
