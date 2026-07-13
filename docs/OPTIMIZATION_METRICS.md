# Audit implementation metrics

The baseline is the executed audit snapshot in `AUDIT_REPORT.md`; current values were captured after the refactor on 2026-07-12. Local timing/RSS values are regression signals, not production SLOs.

| Measure | Audit baseline | Current | Result |
| --- | ---: | ---: | --- |
| Tracked/source scale | 503 tracked files, ~87,000 source lines | 498 inventoried first-party files, 79,440 lines | ~8.7% fewer lines despite adding contracts, tests, CI, security docs, and audit gates |
| Unresolved zero-caller candidates | Named candidates across web/server/Swift | 0 | All original and newly discovered candidates deleted or dynamically/test-owned with a recorded reason |
| Unresolved oversized extraction candidates | Multiple 850–1,800-line mixed owners | 0 | 37 larger cohesive survivors reviewed with explicit retention reasons |
| Initial web JavaScript | 645.79 kB / 184.04 kB gzip entry | 215.85 kB / 65.96 kB gzip initial chunk | ~66% smaller raw and ~64% smaller gzip; no Vite oversized-entry warning |
| Initial web CSS | 44,853 bytes at the pre-CSS-split checkpoint | 31,232 bytes | 30% smaller; call CSS is a 13.62 kB lazy chunk |
| Web tests | 43 tests / 9 files | 55 tests / 16 files | +12 tests and seven suites; all pass |
| Server tests | 47 tests, manual invocation required | 86 discovered tests (82 pass, four integration-only skips) | Service tests are included by the package script; all local unit tests pass |
| Extension tests | 4 tests, no package script | 9 tests | Package-owned suite covers activation, hostile UI, session expiry, indexing, performance, and contracts |
| Worker tests | No executed suite recorded | 11 tests | Auth, expiry, replay, quota, bounds, provider alternate, and timeout paths pass |
| Installed Node dependencies | ~546 MB | ~332 MB (`client` 104 MB, `server` 42 MB, Worker 186 MB) | ~214 MB / 39% reduction; unused 200+ MB ML tree removed |
| Server frequency startup | ~80 ms import, ~110 MB max RSS | 0.07 ms frequency import; first lookup 11.76 ms / 11.92 MB delta | Startup no longer loads all frequency dictionaries |
| Full app import benchmark | Not separately budgeted | 159.69 ms / 84.2 MB RSS delta | Within enforced local startup budget |
| Dictionary paging | Full in-memory grouping/sort risk | 10k-word PostgreSQL p95 32.88 ms, 1.25 MB heap delta | Stable keyset paging with no gap after preceding insert |
| Runtime registrations | ~133 routes, hand-audited | 139 unique routes, 28 exact extension messages, 12 socket registration groups | Dynamic gate rejects duplicates/drift |
| Fallback coverage | No canonical exhaustive ledger | 59 codes / 62 occurrences / 0 incomplete | Every literal guarded path is structured, logged, and visible |
| Local production bundle | One oversized entry | 67 JS chunks, 22 CSS chunks, 924,703 total built bytes | Feature code/styles load on demand and all budgets pass |

The increased file count within some feature directories is intentional decomposition: large mixed files became smaller ownership units. Overall first-party LOC and installed dependency size decreased while contracts, tests, migration/security gates, and documentation increased.

The final release proof ran `npm run check` successfully in the working tree, including eight hermetic iOS UI tests, then ran `npm run setup` and `npm run check:fast` successfully in a sanitized isolated Git workspace under the pinned Node version. Render deployment `dep-d99qp88k1i2s73ekbnjg` passed exact-origin, correlation, role-elevation, token-rotation/revocation, startup, migration, and cleanup verification. Cloudflare Worker version `ed8f1987-e666-41a3-aa37-17ded3982f66` is live with replay KV `f1b0aeb956644a4ea16e83f97de3f35c`; valid production HMAC requests return `200`/`OK`, while replay, wrong-scope, old-signature, and static-bearer probes return correlated structured `401` diagnostics, and live tail records a redacted correlated `worker_diagnostic` warning. Exact audited Render deployment `dep-d9a4k7beo5us739e8ghg` and job `job-d9a4knucjfls7398fmdg` proved the rotated server-owned Worker path succeeds end to end.
