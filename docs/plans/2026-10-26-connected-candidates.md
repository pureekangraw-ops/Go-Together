# Connected candidate implementation plan

Scope: preserve provider work, integrate GO PR26 typed Observatory transfers with PR27 Factory recovery, pair exact upstream Observatory source, and expose Greenhouse read capability only through a verified private read contract. Hub remains registry/relay; no duplicate scheduler.

1. Merge candidate ancestry locally and inspect routing/delivery preservation.
2. Run all GO tests with exact Observatory contract source. Resolve real failures without weakening checks.
3. Review dormant Greenhouse contract with its producer and Hub implementers; default deny and retain unresolved Work ownership.
4. Independently review integrated change and build Worker dry-run.
5. Publish to original candidate branch using current-head lease; read back final CI and record exact dependencies.

No production deployment, merge to main, secret/permission changes, Slack work, or UNKNOWN job replay. Source-only capability does not prove live activation or handset acceptance.
