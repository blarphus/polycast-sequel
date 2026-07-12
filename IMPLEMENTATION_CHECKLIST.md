# Polycast audit implementation checklist

This is the live completion ledger for `AUDIT_REPORT.md`. An item is checked only after its implementation and acceptance evidence are complete. “Partial” means code has moved toward the requirement but the audit’s full done condition has not yet been proven.

## P0/P1 — security, correctness, and release truth

- [ ] **AUD-001 — Remove distributed Worker credentials and secure privileged media calls.** Local implementation complete: client credentials removed, every transcript/playability/related/TTS server call uses one scoped HMAC authority, a regression gate forbids distributed or legacy static-bearer paths, and expiry/replay/action quotas, bounded inputs, and fault tests pass. `AUTH_REPLAY` is declared for authenticated automatic provisioning and dry-run binding proof passes. Remaining: authenticate Wrangler, rotate the deployed secret, deploy, and capture rejection/replay/log evidence.
- [ ] **AUD-002 — Correct API trust boundaries, roles, and sessions.** Roles/profile switching/revocable sessions and migration/PG tests are implemented. HTTP and Socket.IO share one tested origin-policy authority; the production web/Worker origins are exact and machine-checked, an extension origin is admitted only when its stable ID is explicitly configured, and omission fails closed without taking down the web service. Web, extension, and iOS perform one centralized, detailed, visible, logged teardown on an authenticated 401. Remaining: production environment verification after deployment.
- [x] **AUD-003 — One canonical SRS model across server/web/iOS/widget.** Generated versioned constants, source hashes, cross-platform golden fixtures, full-stage queue behavior, iOS failure/relearning coverage, and `srs_algorithm_version` response proof are present.
- [x] **AUD-004 — Canonical API/message contracts.** Exact OpenAPI/JSON schemas and fallback envelope, generated TS/Swift models, central auth serialization, representative fixtures on server/web/extension/Swift, generated extension message registry, and strict correlated direct/group socket envelopes are enforced; missing or extra fixture fields fail contract generation.
- [x] **AUD-005 — Complete Group Call app-level state machine.** App-shell ownership, reconnect without duplicate REST/media join, room switching/cancellation, logout/pagehide teardown, exact signaling validation, stale-room rejection, participant dedupe, and listener/media leak tests pass.
- [x] **AUD-006 — Make retries idempotency-safe.** Automatic retries are read-only by default; review mutations use persisted user/operation/body-bound idempotency keys with lost-response replay and key-reuse rejection tests.
- [x] **AUD-007 — Remove extension HTML injection and constrain page activation.** Remote text never reaches HTML sinks, hostile payload tests pass, generic sites require exact-origin optional permission and registration, and every denial remains visible.
- [x] **AUD-008 — Remove vulnerable/unused dependencies.** Unused inference dependencies were removed; production CycloneDX SBOMs, zero-vulnerability audits, lockfile/exception policy, clean `npm ci` CI, and Dependabot automation are enforced.
- [x] **AUD-009 — Every fallback is detailed, structured, logged, and visible.** The generated 53-code guarded-path inventory has zero incomplete occurrences; the check gate verifies structured source/operation/correlation, logging, and relevant-UI delivery. Web/iOS/extension/server/Worker adapter and fault tests cover hostile payloads, provider alternates, offline/session paths, retries, signaling rejection, scheduling repair, and fallback delivery.
- [x] **AUD-010 — One truthful green release check.** The final root check passed across contracts, fallbacks, formatting, tools, inventories, web, server, extension, Worker, fresh/legacy PostgreSQL, and iOS unit/UI tests. A sanitized isolated workspace then completed pinned Node 22.12.0 clean installs and the credential-free `check:fast` gate; this proof also found and fixed a benchmark `--help` path that had incorrectly required a local Gemini key.

## P2 — pipeline simplification, performance, and architecture

- [x] **AUD-011 — Make dictionary reads pure.** Read projections are pure; mutations/day boundaries mark or repair scheduling explicitly, with advisory locking, detailed repair diagnostics, and query-shape tests.
- [x] **AUD-012 — Database-backed bounded dictionary pagination.** All six sorts use context-bound stable keyset cursors, limit+1 SQL, immutable total propagation, supporting indexes, and a real 10k-word PG latency/heap/no-gap test.
- [x] **AUD-013 — Remove startup data/cache waste.** Frequency maps lazy-load into a six-language bound, article parsing is dynamically imported, Redis namespaces are versioned with no `KEYS`/blanket flush, and startup RSS/latency budgets pass.
- [x] **AUD-014 — Split initial web payload.** Routes and feature CSS are lazy, call/transcript/word-popup CSS was removed from the shell and now ships as a route chunk, shared shell/base primitives remain global, Vite has no oversized-entry warning, and byte/gzip budgets pass. Initial CSS fell from 44,853 to 31,232 bytes.
- [x] **AUD-015 — Simplify route pipelines.** Dictionary is a four-router composer over word/media/study services; video and classroom transports validate and delegate through the central async/error mapper; intentional transcript/TTS alternates preserve structured visible diagnostics. The dynamic registry proves 139 unique routes after the split.
- [x] **AUD-016 — Split files with mixed ownership.** Practice start/card/session views, Videos/Shorts/cards, widget intents/provider/view/registration, API transport/domain endpoints, transcript domain/views/popup, extension message validation/activation, and dictionary schedule/sense/study/group/calendar queries now have separate tested ownership seams. XcodeGen and the full app+widget simulator build pass.
- [x] **AUD-017 — Consolidate duplicated cross-platform behavior.** Generated language/SRS registries, golden transcript/tokenization fixtures across web/extension/Swift, canonical SRT behavior, and the extension-safe shared widget snapshot infrastructure replaced hand-maintained copies.
- [x] **AUD-018 — Narrow the Worker pipeline.** Routing/auth/HTTP/TTS/playability/transcript/related concerns are separated; body/batch/time limits, scoped quotas, replay protection, request IDs, and detailed alternate-path tests pass.
- [x] **AUD-019 — Structured, private, correlated logging.** Web runtime files use scoped structured/redacted diagnostics with visible warning/error dispatch; server runtime uses pino; extension logs accept only full fallback/diagnostic envelopes; iOS uses OSLog. The logging ban gate and HTTP/socket correlation tests prevent regression.
- [x] **AUD-020 — Harden migrations, generation, and deploys.** Immutable contiguous migration checks plus fresh/legacy PG tests, XcodeGen drift enforcement, exact Swift packages, pinned Node/clean installs, and documented backup/restore/destructive-release policy are present.

## P3 — pruning, combining, and repository ownership

- [x] **AUD-021 — Delete dead code after caller verification.** Every originally listed web/server/Swift export, `PracticeHubView`, obsolete `BrowseView`, and `check_word.js` is gone; live detail views were split. A second inventory pass removed dead native local-media, transcript, drill, study-interleaver, goal/group helper, and provider-candidate chains. Static and dynamic registration gates now report zero unresolved zero-caller candidates.
- [x] **AUD-022 — Repair and consolidate tools/prototypes.** Enrichment imports/smoke mode, common WSD tooling/dependencies, maintained-tool help and non-writing modes, archived one-time prototypes, and generated research simulator/catalog drift checks are enforced.
- [x] **AUD-023 — Eliminate local generated bloat safely.** Checks use one `/tmp` DerivedData location; ignored legacy build directories have a size-reporting cleanup command that requires literal confirmation and never deletes user artifacts automatically.
- [x] **AUD-024 — Root ownership and release automation.** Root setup/check/format/audit/generate/SBOM/inventory/registration/clean commands, architecture ownership and cross-platform matrices, version policy, CI, and dependency automation are present.

## End-to-end pipeline review ledger

Each row must end with one intentional primary path, explicit bounded alternates, detailed visible diagnostics for every alternate, no redundant transforms/fetches, and measured acceptance evidence.

For every row, record before/after evidence covering: entry points and ownership; request/event/data flow; duplicated fetches, transforms, retries, caches, and persistence; fallback trigger and recovery conditions; visible structured diagnostic code/source/operation/correlation; cancellation, timeout, and teardown behavior; query/network count; latency/memory where material; and the tests proving primary and alternate paths. A row is not complete merely because it works—the remaining stages must each have a distinct, necessary responsibility.

- [x] Authentication/login/restore/profile switch/logout/session revocation
- [x] Dictionary lookup/enrichment/image/translation/save/offline synchronization
- [x] Study scheduling/day boundary/queue projection/review/stage-sentence generation
- [x] Dictionary grouping/search/sort/pagination/calendar/widget preview
- [x] Video discovery/search/channel/lesson/Shorts/playability
- [x] Transcript acquisition/queue/retry/provider selection/upload/rendering
- [x] TTS/voice practice/provider fallback/audio delivery
- [x] Direct call signaling/media/transcription/minimize/end
- [x] Group call signaling/media/transcription/navigation/reconnect/end
- [x] EPUB/local video import/storage/parsing/progress/lookup
- [x] Classroom/classwork/templates/student authorization
- [x] Extension page activation/language detection/highlighting/lookup/offline bridge
- [x] iOS widget auth/snapshot/image cache/refresh
- [x] Server startup/migration/Redis/cache/background workers/deployment

Detailed ownership, primary/alternate flows, bounds, diagnostics, and acceptance evidence are recorded in `docs/PIPELINE_AUDIT.md`.

## Prune/combine proof checklist

- [x] Run static reference analysis and dynamic route/message registration checks. `check:inventory` plus `check:registrations` inspect 139 live routes, 28 extension messages, socket registrations, and caller candidates.
- [x] Produce a file/function inventory with size, responsibility, callers, side effects, and test coverage; flag oversized files, mixed ownership, near-duplicates, forwarding shells, and zero-caller code. See `docs/CODE_INVENTORY.md` and its complete JSON ledger.
- [x] Classify every candidate as delete, combine, extract, generated, prototype, or intentionally standalone.
- [x] Record a concrete disposition for every flagged candidate, including why retained candidates must remain separate and why combined candidates enforce the same invariant. The generated inventory has 37 reviewed oversized owners, zero unresolved extract candidates, and a reason for every retention.
- [x] Delete only after targeted tests prove no caller/registration remains. Static caller review plus runtime route/message registration now reports zero unresolved zero-caller candidates.
- [x] Combine functions only where they enforce the same invariant; no generic abstraction layer was introduced for coincidental similarity.
- [x] Verify each surviving pipeline has one authoritative implementation per invariant and that platform-specific copies are generated, fixture-tested, or explicitly justified. See `docs/PIPELINE_AUDIT.md`.
- [x] Inspect every fallback after simplification: the generated 53-code inventory has zero incomplete structured/logged/visible occurrences and is backed by platform fault tests.
- [x] Compare file/function counts, first-party LOC, bundle size, install size, startup RSS, query count, and test coverage before/after. See `docs/OPTIMIZATION_METRICS.md`.
- [x] Re-run all platform gates and complete a requirement-by-requirement audit against all 24 findings. Twenty-two findings are acceptance-complete; AUD-001 and AUD-002 are locally complete but intentionally remain open until their credentialed production deployment/verification evidence exists.
