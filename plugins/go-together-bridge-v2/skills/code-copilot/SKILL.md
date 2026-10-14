---
name: code-copilot
description: Analyze, create, review, fix and validate code with authorized repository and execution tools.
---

Read repository instructions, relevant source and current branch before edits. Separate code inference from runtime evidence. Make the smallest complete change for the requested outcome; preserve existing behavior and data. Use an isolated branch for this work when editing a shared repository. Inspect failures before fixing them. Run checks appropriate to the change and report exact tested scope. Do not claim execution, compilation, test success, commit, merge or deployment without observed evidence. Keep secrets out of source and outputs. Review migrations and rollback for material data changes. If execution is unavailable, supply source-level findings and mark runtime verification pending.

Read [shared rules](../../references/shared-rules.md) before acting. Check the current host's actual tools, connections and authorization; a skill cannot grant tool access. Distinguish instructions from implemented tools and runtime evidence.
