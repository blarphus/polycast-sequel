# Polycast full-project audit

**Audit date:** 2026-07-11
**Scope:** web client, Node server, PostgreSQL migrations, Redis/socket layer, iOS app, iOS widget, Chrome extension, Cloudflare Worker, VLC prototype, scripts, research assets, tests, deployment configuration, dependencies, and the current working tree.
**Deliverable type:** baseline audit plus implemented remediation record.

## Implementation closure status

The findings and measurements below preserve the original 2026-07-11 baseline. The remediation was completed locally on 2026-07-12 and is tracked requirement-by-requirement in `IMPLEMENTATION_CHECKLIST.md`.

| Status | Count | Scope |
|---|---:|---|
| Acceptance-complete | 23 | AUD-002 through AUD-024, including production trust/session verification, pipeline simplification, decomposition, pruning, fallback visibility, and the clean-workspace release proof |
| Locally implemented; production evidence pending | 1 | AUD-001 Worker OAuth authorization, secret rotation, replay-KV provisioning, deploy, and rejection/replay/log evidence |

The final local root gate passed contracts, fallback and logging policy, source/tool inventories, web, server, extension, Worker, fresh and legacy PostgreSQL migrations, integration benchmarks, Xcode generation, and iOS unit/UI tests. A separate sanitized workspace passed pinned clean installs and the credential-free non-iOS gate. Render deployment `dep-d99qp88k1i2s73ekbnjg` then proved production origins, correlation, role boundaries, session rotation/revocation, and clean temporary-account teardown. See `docs/OPTIMIZATION_METRICS.md`, `docs/PIPELINE_AUDIT.md`, and `docs/CODE_INVENTORY.md` for measured and disposition evidence.

## Executive assessment

Polycast has a coherent product and more tests than its package scripts suggest, but a year of additive development has created four systemic risks:

1. **Security boundaries are inconsistent.** A shared Worker bearer secret is compiled into the iOS app, all Chrome-extension origins are accepted by the API/socket CORS checks, long-lived JWTs are retained in browser storage, and expensive endpoints lack per-user budgets.
2. **Core behavior is independently reimplemented.** SRS progression, transcript parsing, language metadata, fallback reporting, tokenization, and client contracts have drifted across JavaScript, TypeScript, Swift, the extension, and the Worker. The web SRS implementation currently caps a 20-stage server model at stage 3.
3. **Important read paths do hidden work.** Dictionary reads mutate and reschedule a user's full study set; grouped pagination reads and sorts the full dictionary in JavaScript; frequency tables are synchronously loaded at server import; startup flushes Redis video caches using blocking `KEYS`.
4. **Quality gates do not represent release health.** Web tests pass while TypeScript compilation fails. Server and extension tests pass but are not wired to package scripts. One iOS unit test and most UI scenarios fail. There is no repository CI, lint gate, contract test, Worker test, or reproducible full-project check.

The immediate priority is not a broad rewrite. Secure the trust boundaries, restore one source of truth for study behavior and API contracts, make the current build/test baseline honest, and then simplify the hottest pipelines. The recommended sequence at the end of this report is designed to preserve visible fallback diagnostics while removing the conditions that trigger them.

### Priority summary

| Priority | Count | Meaning |
|---|---:|---|
| P0 | 1 | Treat as exposed now; remediate before the next release |
| P1 | 9 | Correctness, security, or reliability work for the next stabilization cycle |
| P2 | 10 | Material performance and maintainability improvements |
| P3 | 4 | Cleanup and repository hygiene |

## Method and coverage

This audit combined repository-wide inventory/searches, dependency graph and vulnerability inspection, history/churn review, build and test execution, syntax/manifest validation, bundle analysis, targeted timing/memory measurements, and manual review of every executable surface and its high-risk pipelines. It is not a production penetration test or production database profiler; SQL scaling conclusions are based on query shape and should be confirmed with representative `EXPLAIN (ANALYZE, BUFFERS)` output before index rollout.

### Repository inventory

| Area | Tracked files | Main languages/surfaces | Audit coverage |
|---|---:|---|---|
| Web client | 209 | React, TypeScript, CSS, EPUB/WebRTC | all files scanned; entry points, API, study, calls, reader, video, styles, and tests manually reviewed |
| Server | 154 | Express, PostgreSQL, Redis, Socket.IO, media/AI integrations | all files scanned; every route family, middleware, migration, service, cache, scheduler, and startup path reviewed |
| iOS + widget | 90 | SwiftUI, WebRTC, AVFoundation, WidgetKit, CallKit | all files scanned; app/widget entry points, networking, study, video, calls, persistence, and tests reviewed; both targets compiled |
| Chrome extension | 24 | Manifest V3 JavaScript/CSS/HTML | all files scanned; background dispatch, content scripts, popup, bridge, permissions, and tests reviewed |
| Cloudflare Worker | 4 | Worker JavaScript/Wrangler | full source/config/dependencies reviewed and dry-run bundled |
| Scripts/research/VLC/docs/root | 19 | JS, Python, Lua, HTML, configuration | all tracked files classified and scanned; executable scripts syntax-checked |

There are 503 tracked files and roughly 87,000 tracked source lines. The largest first-party source files are `PracticeView.swift` (1,808 lines), `students.css` (1,534), `conjugations.ts` (1,254), `call.css` (1,245), `VideosView.swift` (1,189), `server/routes/channels.js` (1,144), `TodayWordsWidget.swift` (1,078), `extension/background.js` (1,018), `TranscriptComponents.swift` (905), and `APIClient.swift` (893).

### Executed baseline

| Check | Result |
|---|---|
| Web unit tests | **Pass:** 43 tests in 9 files |
| Web production build | **Pass with warning:** one 645.79 kB minified entry chunk (184.04 kB gzip), above Vite's 500 kB warning threshold |
| Web TypeScript check | **Fail:** 7 errors; strict unused check adds 2 more |
| Server tests | **Pass:** 47 tests, but only when test files are invoked manually |
| Extension tests | **Pass:** 4 tests, including the performance test, but there is no package script |
| iOS unit tests | **Fail:** 40 executed; 2 assertions fail in one SRS queue-classification test |
| iOS UI tests | **Fail:** 8 scenarios; 11 assertion failures; fixtures depend on simulator login/books, live media, and unstable layout assumptions |
| iOS/widget compilation | **Pass with warnings:** deprecated CallKit/AVAudio APIs and Swift concurrency sendability warnings |
| Worker bundle | **Pass:** 9.58 kB upload / 2.83 kB gzip; Wrangler 3 warns that 4.x is current |
| Tracked JS/JSON/plist validation | **Pass** |

Current TypeScript failures are concrete evidence of contract drift: offline auth objects omit required progression fields, `PhraseTranslator` passes a nullable target language, `WordLookupModal` uses an incompatible local shape, `ChatView` encodes a possibly undefined name, and two `Object.hasOwn` calls require a newer library target or compatible implementation.

### Workspace state

The audit intentionally includes these pre-existing, uncommitted files:

- modified `client/src/hooks/useGroupCall.ts`
- modified `client/src/pages/GroupCall.tsx`
- untracked `client/src/contexts/GroupCallProvider.tsx`

They were not altered. Finding AUD-005 is explicitly a **WORKTREE** finding and should not be confused with committed mainline behavior.

## Findings and implementation specifications

Severity is ordered P0 (release blocker), P1 (high), P2 (medium), P3 (cleanup). Each specification includes a measurable completion condition.

### AUD-001 — Shared Worker credential is shipped in the iOS binary

**Priority:** P0 — security
**Evidence:** `ios/Polycast/Sources/Core/AppConfig.swift` hard-codes `transcriptWorkerSecret`; `TranscriptWorkerClient.swift` sends it as a bearer token. A mobile binary cannot keep a shared secret. The Worker also embeds a reusable YouTube client key in both Swift and Worker code.
**Impact:** Anyone who obtains the app can extract and reuse the Worker credential, consume AI/media quota, and bypass the intended caller boundary. Assume the current value is disclosed even if the repository is private.

**Implementation specification:**

1. Rotate the Worker secret immediately and review Worker usage logs from the first shipped build onward.
2. Remove the shared secret and key from all client targets and history-aware secret scans. Do not replace them with obfuscation.
3. Put privileged transcript/TTS calls behind the authenticated server. The server may call the Worker with a server-only credential, or mint short-lived, single-purpose tokens containing user ID, action, expiry under five minutes, nonce, and quota.
4. Enforce per-user and per-action rate limits at the server and Worker; return a visible structured diagnostic on denial or downstream fallback.
5. Store the public media client identity in environment/config only if it truly must remain client-visible; restrict its upstream quota and document that it is an identifier, not a secret.

**Done when:** released iOS/extension/web artifacts contain no privileged credential; the old secret is rejected; replay/expiry/quota tests pass; an unauthorized Worker request receives 401; and fallback/rate-limit diagnostics appear in the calling UI.

### AUD-002 — API trust boundaries permit broad origin and role elevation

**Priority:** P1 — security/authorization
**Evidence:** `server/index.js` and `server/socket/index.js` accept any origin beginning `chrome-extension://` while allowing credentials. Settings allow a user to change their own `account_type`, yet teacher middleware unlocks classroom, student-search, template, and AI operations. JWTs default to a 365-day lifetime, and `client/src/utils/savedAccounts.ts` stores account-switch bearer tokens in `localStorage`. A fallback JWT secret is accepted outside a clearly isolated test harness.
**Impact:** The CORS rule trusts unrelated extensions; an XSS has long-lived account-switch tokens available; and “teacher” is an authorization role that users can self-grant.

**Implementation specification:**

- Restrict CORS/socket origins to an explicit configured extension ID plus the web origins. Add negative tests for an arbitrary extension origin.
- Decide whether teacher/student is a cosmetic mode or a privilege boundary. If privileged, move role changes to invitation/admin flows and authorize every classroom operation by membership/ownership, not role alone. If cosmetic, rename it and remove it from authorization decisions.
- Replace year-long bearer persistence with short-lived access credentials plus rotating, revocable server sessions. Implement account switching with server-managed sessions; do not put reusable JWTs in web storage.
- Make production/staging startup fail when `JWT_SECRET`, extension origin, or session configuration is absent. Permit deterministic development secrets only under an explicit test/development environment.

**Done when:** arbitrary extension origins fail CORS and socket handshakes, self-service settings cannot grant protected capabilities, token theft has a short bounded lifetime, logout/revocation invalidates all clients, and integration tests cover the role/ownership matrix.

### AUD-003 — SRS progression has already diverged across platforms

**Priority:** P1 — product correctness
**Evidence:** the server and iOS use `MAX_PROMPT_STAGE = 20`, matching `FLASHCARDS.md`. `client/src/utils/srs.ts` and `client/src/pages/Learn.tsx` clamp stage state/display to 3. Server, web, offline web, iOS, and widget queue classification each contain related scheduling logic. The failing iOS unit test expected a new learning card but received review classification.
**Impact:** a web review can regress or misrepresent cards beyond stage 3, and the same card can enter different queues depending on platform.

**Implementation specification:**

1. Define a versioned SRS contract with canonical fixtures covering stages 0, 1, 2, 3, 4, 19, 20; correct/incorrect answers; due boundaries; time zones; and legacy rows.
2. Keep authoritative transitions on the server. Clients may optimistically project only by calling a generated/pure implementation proven against those fixtures; the server response must reconcile state.
3. Move constants, interval tables, stage-color semantics, and queue names into a generated JSON artifact consumed by TypeScript and Swift tests.
4. Fix web clamps and the iOS queue test/implementation based on the written stage specification, not on current behavior.
5. Add cross-platform golden tests and migration/version handling before changing the algorithm again.

**Done when:** the same fixture produces byte-equivalent semantic results in server, web/offline, and Swift tests; stages 4–20 survive web review; all iOS tests pass; and the API includes an SRS algorithm version.

### AUD-004 — Handwritten API models are drifting

**Priority:** P1 — correctness
**Evidence:** current TypeScript errors expose mismatched auth and word-save shapes. Login/signup do not select `daily_new_limit` while other auth responses do. Web `SavedWord` omits stage-sentence data used elsewhere. Swift, extension, and TypeScript separately describe many of the same payloads. `WordLookupModal` defines a narrower local save type instead of reusing the API type.
**Impact:** valid server responses are silently ignored, offline responses are incomplete, and platform builds catch only a subset of breaking changes.

**Implementation specification:**

- Introduce an OpenAPI or JSON Schema contract for external HTTP payloads and the fallback diagnostic envelope. Generate TypeScript types and Swift `Codable` models; validate server responses in contract tests.
- Use explicit SQL columns and central response mappers. Make login, signup, restore, and `me` return the same `AuthUser` shape.
- Define versioned schemas for Socket.IO and extension messages as well as HTTP.
- Replace component-local request/response interfaces with imported domain types. Add representative response fixtures consumed by server, web, extension, and Swift tests.

**Done when:** `tsc --noEmit` passes, Swift decodes every shared fixture, missing/extra required fields fail CI, and auth endpoints share one documented response schema.

### AUD-005 — WORKTREE Group Call provider is not mounted

**Priority:** P1 — current worktree runtime failure
**Evidence:** the modified `GroupCall.tsx` calls `useActiveGroupCall()`. The untracked provider throws when used outside `GroupCallProvider`, but `client/src/App.tsx` does not mount that provider. Static build/test coverage does not navigate this path. Comments promise a group-call floating tile, while the existing tile remains one-to-one-call specific.
**Impact:** entering the modified Group Call page throws at runtime; navigation persistence and cleanup semantics are incomplete.

**Implementation specification:**

- Mount the provider at the narrowest app-shell level that must survive route changes, inside auth/socket ownership and outside route content.
- Define one active-call state machine for joining, connected, navigating away, rejoining, switching rooms, ending, socket reconnect, and auth logout. Include room ID checks in every event handler and catch/diagnose asynchronous handlers.
- Either extend the floating tile with an explicit discriminated `direct | group` call model or ship a separate group tile; do not infer call type from partial state.
- Add a route integration test that mounts the real app providers, joins a room, navigates away/back, ends, and confirms listener/media cleanup.

**Done when:** the route no longer throws, only one listener/media set exists after repeated navigation, stale-room events are ignored with structured diagnostics, and direct-call tests remain green.

### AUD-006 — iOS retries non-idempotent requests after 5xx

**Priority:** P1 — data integrity
**Evidence:** `APIClient.swift` gives the generic request path a retry budget without restricting by HTTP method. POST/PATCH operations such as messages, saves, and classroom actions can therefore execute twice when the first response is lost or returns a retriable status.
**Impact:** duplicated side effects and confusing state after transient server failures.

**Implementation specification:** retry GET/HEAD automatically with capped exponential backoff and jitter. Retry mutations only when they carry a stable idempotency key persisted across the retry; store/deduplicate that key server-side for the operation's risk window. Never retry validation, auth, or deterministic 4xx failures. Surface a structured `network_retry_used` diagnostic if a retry materially changes the request path.

**Done when:** mutation fault-injection tests prove one side effect under lost responses, idempotent reads still retry, and users can see when recovery/retry behavior was used.

### AUD-007 — Extension fallback toast permits HTML injection

**Priority:** P1 — security
**Evidence:** `extension/content/shared.js` builds `showFallbackToast` with `innerHTML` from unescaped `title` and `message`; those values may originate in remote error/fallback payloads and are inserted into arbitrary pages. The extension injects content scripts on all HTTP(S) pages.
**Impact:** a crafted diagnostic can inject markup into a page under the extension's content-script context; broad host injection increases privacy and performance exposure.

**Implementation specification:** build toast nodes with `textContent`; use a reviewed sanitizer only where formatted content is a real requirement. Validate every message at the background/content boundary. Add malicious `<img onerror>`/SVG/attribute payload tests. Review whether selection/highlight scripts can be registered on demand or limited by user-controlled host permissions, and bound mutation work per page.

**Done when:** hostile payload tests create text only, no remote string reaches `innerHTML`, content activation/host scope is documented and controllable, and fallback notices remain visible.

### AUD-008 — Dependency exposure is high and includes a large unused ML tree

**Priority:** P1 — supply chain/bloat
**Evidence (2026-07-11):** `npm audit` reports 12 client vulnerabilities (1 critical, 5 high), 22 server vulnerabilities (1 critical, 12 high), and 6 Worker vulnerabilities (3 high). Direct affected packages include Vitest 4.0.18, Vite 5.4.21, React Router 6.30.3, Express, express-rate-limit, fast-xml-parser, ws, and Wrangler 3.114.17. The Vitest issue is fixed in 4.1.0 ([GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)); the dependency tree also includes the current ws fragmentation DoS ([GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)). `@xenova/transformers` has no runtime import but pulls the sole vulnerable protobuf/ONNX tree and well over 200 MB of installed dependencies.
**Impact:** avoidable attack surface, slow installs, and difficult upgrades.

**Implementation specification:** remove `@xenova/transformers` after one import/runtime smoke check; update patched same-major dependencies first; then migrate Vite/Wrangler majors in isolated changes. Generate production SBOMs and run audits in CI with an explicit temporary-advisory exception file containing owner and expiry—never blanket `--audit-level` suppression.

**Done when:** the unused tree is absent from `npm explain`, clean installs/builds/tests pass, no unexpired critical/high production advisory remains, and exceptions are visible and time-bounded.

### AUD-009 — Fallback diagnostics are implemented inconsistently

**Priority:** P1 — supportability/project invariant
**Evidence:** web API and several iOS/extension word paths correctly surface fallback notices. Other paths silently consume failure: extension tab broadcasts use `.catch(() => {})`, dictionary/local-video refreshes suppress catches, direct iOS transcript attempts fall through to the Worker without `FallbackNoticeCenter`, Watch channel lookup prints then substitutes, Worker caption-track selection is implicit, and stage-sentence generation logs while serving fallback content.
**Impact:** users and developers cannot tell whether results came from the intended pipeline, stale/local data, or a degraded path. This violates the workspace fallback rule.

**Implementation specification:** standardize a versioned diagnostic object: `{ code, severity, title, message, source, operation, correlationId, occurredAt, detail? }`. Carry it in JSON payloads, response headers where needed, socket messages, Worker responses, and offline results. Implement one presenter per UI surface with deduplication but no suppression. Replace silent catches with either expected best-effort outcomes that emit telemetry/diagnostics or errors that propagate. Redact secrets and personal data.

**Done when:** a repository check rejects empty catch handlers in first-party runtime code, fault-injection tests for every documented fallback assert both the fallback result and visible notice, and logs correlate the notice across client/server/Worker.

### AUD-010 — Release checks are red despite passing headline tests

**Priority:** P1 — release reliability
**Evidence:** TypeScript compilation fails; one iOS SRS unit test fails; UI tests have 11 failures and depend on persistent simulator state/live media; Swift emits concurrency and deprecated-API warnings. Server/extension tests are invisible to their package scripts.
**Impact:** regressions can merge while local `npm test` appears healthy, and UI failures cannot distinguish product defects from missing fixtures.

**Implementation specification:** add a root `check` orchestration script and CI jobs for web typecheck/test/build, server tests, extension tests, Worker tests/dry bundle, migration smoke, iOS/widget build, iOS unit tests, and a hermetic UI subset. Inject authenticated users, books, captions, and media responses through launch arguments/test stores; separate live YouTube smoke tests from deterministic UI tests. Fix warnings with actor/sendability design and current APIs, not warning suppression.

**Done when:** a clean checkout has one documented command, every job is green, UI tests create their own state, and branch protection requires the gates.

### AUD-011 — Dictionary reads repeatedly mutate and scan scheduling state

**Priority:** P2 — performance/contention
**Evidence:** `ensureCardsScheduled` performs four user-wide update phases and is called before words, due, new-today, preview, overview, widget, grouping, calendar, and day queries. A read request can renumber queues, clear due dates, set dates, and roll cards over.
**Impact:** latency and write amplification grow with every saved word; concurrent web/widget/app reads contend and invalidate caches.

**Implementation specification:** make reads pure. Run scheduling transactionally when a word/review/settings change makes it dirty and once at the user's day boundary, tracked by `(user_id, schedule_version, local_day, dirty_at)`. For recovery, provide one idempotent server job and expose a visible `schedule_repair_used` diagnostic when it is invoked on demand. Add targeted indexes after representative query plans are recorded.

**Done when:** ordinary dictionary GETs issue no UPDATE, concurrent readers do not change state, day-boundary and settings-change fixtures remain correct, and p95 query count/time is measured before and after.

### AUD-012 — Grouped dictionary pagination loads everything and caches without a bound

**Priority:** P2 — performance/memory
**Evidence:** `listDictionaryGroupPage` selects a user's full saved-word set, projects/groups/sorts it in JavaScript, then slices a page. `_groupCache` is a module-level `Map`; TTL is checked only for a requested key, so expired arbitrary search/sort/time-zone keys remain until user invalidation/process restart. Search applies functions to text columns, limiting normal index use.
**Impact:** request memory/CPU and process memory scale with dictionary size and query-key variety; “pagination” does not protect the database or server.

**Implementation specification:** define stable grouping semantics in SQL, page with a deterministic cursor, fetch details for only page group keys, and use normalized/search indexes justified by query plans. Remove the cache after SQL optimization or replace it with a bounded LRU/Redis namespace with max entries, TTL eviction, metrics, and user revision keys.

**Done when:** database rows and heap allocated per page are bounded, cursors have no duplicates/skips under inserts, cache size is capped and observable, and a large-dictionary benchmark meets an agreed p95 budget.

### AUD-013 — Server startup eagerly loads frequency data and destroys warm caches

**Priority:** P2 — startup/memory/cache efficiency
**Evidence:** `server/lib/wordFrequency.js` synchronously reads/parses six 50k-word files during import through `enrichWord`; an isolated import took about 80 ms and reached roughly 110 MB max RSS on this machine. `server/index.js` calls blocking Redis `KEYS` for multiple video prefixes and deletes all matches on every startup.
**Impact:** cold starts pay for features not yet used, each process duplicates the maps, Redis is blocked by keyspace scans, and deploys discard useful caches.

**Implementation specification:** generate a compact indexed artifact and lazy-load by requested language, with measured memory. Version Redis cache namespaces (`video:vN:*`) and let old keys expire; if cleanup is required, use incremental `SCAN` in a background maintenance task, not startup. Do not silently operate without a required Redis dependency—surface degraded behavior according to the fallback contract.

**Done when:** startup does not read frequency files or execute `KEYS`, warm deployments retain current-version cache hits, and startup RSS/latency plus first-frequency-lookup latency are benchmarked.

### AUD-014 — Web routing and CSS force unrelated features into the initial bundle

**Priority:** P2 — frontend performance
**Evidence:** `App.tsx` statically imports all route pages. `main.css` imports the full style tree. The build produces a 645.79 kB minified main chunk and warning. `students.css` and `call.css` each contain navigation/sidebar bases and later overrides; feature CSS is globally parsed.
**Impact:** users download/parse calls, EPUB, classroom, video, and other code before visiting those routes; duplicated global selectors make regressions likely.

**Implementation specification:** convert route modules to `React.lazy`/dynamic imports with a small app shell and meaningful loading/error UI. Split heavy EPUB/WebRTC/video vendors where measurement supports it. Import feature CSS from route modules. Consolidate actual shared navigation, modal, icon-button, card-grid, and metadata primitives; keep feature-specific styles scoped rather than creating a generic utility layer for every repeated declaration.

**Done when:** the Vite chunk warning is gone, route chunks load on demand, critical navigation has a stable shared stylesheet, visual regression/smoke tests pass, and CI records bundle sizes against a reviewed budget.

### AUD-015 — High-churn server routes repeat transport boilerplate

**Priority:** P2 — maintainability
**Evidence:** the server has about 133 route handlers. `routes/dictionary.js` is 852 lines with 26 route/error blocks; `videos.js` and classroom families repeat validation, `try/catch`, logging, and 500 responses despite global middleware. Dictionary is also the highest history churn hotspot.
**Impact:** response behavior and diagnostics vary by endpoint; large files mix transport, authorization, SQL orchestration, integration fallback, and presentation.

**Implementation specification:** introduce a small `asyncHandler`, typed domain errors, centralized error-to-response/diagnostic mapping, and shared Zod middleware. Split dictionary into word CRUD, lookup/enrichment, study/schedule, and media routes/services; split other route files only along domain seams. Preserve specific fallback codes and UI visibility during extraction.

**Done when:** route handlers contain validation/auth/delegation only, errors map centrally with correlation IDs, snapshot/contract tests show no response regression, and no extracted service imports Express request/response objects.

### AUD-016 — Several files combine unrelated ownership and lifecycle

**Priority:** P2 — maintainability/testability

| File | Current mixed responsibilities | Recommended boundary |
|---|---|---|
| `PracticeView.swift` (1,808) | obsolete hub, setup, card UI, audio preloading, hands-free, review networking, card info | feature start view; session view model; card faces/components; audio/hands-free coordinator; info sheet |
| `VideosView.swift` (1,189) | tabs/search/subscriptions, Shorts ranking/feed/player, cards | video shell; search/subscriptions; Shorts model/player; reusable cards |
| `TodayWordsWidget.swift` (1,078) | intents, provider, keychain, API, refresh gate, images, every layout | intents/provider; extension-safe auth/network module; image store; layouts |
| `APIClient.swift` (893) | transport, retry, diagnostics, every domain endpoint, widget cache | core transport; domain endpoint extensions/services; cache adapter |
| `TranscriptComponents.swift` (905) | SRT parsing/tokenization, list UI, popup, save flow | parser/domain; transcript view; lookup popup; save coordinator |
| `extension/background.js` (1,018) | auth, offline sync, progression, lookup, settings, broadcasts, 30-case dispatch | schema-validated router plus domain handlers/services |
| `dictionaryQueries.js` (860) | scheduling, projections, grouping/cache, calendars | scheduler; list/read repository; group repository; calendar repository |

**Implementation specification:** extract behavior behind tests one seam at a time; do not merely turn one large file into many mutually importing fragments. Each new module must have one reason to change and explicit injected dependencies. Keep platform target membership visible for widget-safe Swift code.

**Done when:** the listed coordinators/views primarily compose smaller units, extracted business logic has focused unit tests, dependency direction is acyclic, and behavior/bundle benchmarks do not regress.

### AUD-017 — Cross-platform duplication needs fixtures, not an attempted universal runtime

**Priority:** P2 — consistency
**Evidence:** SRT parsing exists in web, iOS, and VLC with different timestamp/duration handling. Language names/codes live in several client and Swift lists. Tokenization, speaker colors, tilde cleanup, and stage display rules are repeated. Widget networking/keychain/image code duplicates app concerns.
**Impact:** subtle platform differences accumulate, but forcing Swift/JS/Lua into one runtime would add more complexity than it removes.

**Implementation specification:** create canonical JSON registries for languages/stage metadata and a golden corpus for transcript timestamps, malformed cues, tokenization, language codes, and fallback cases. Generate platform-native constants/models and run fixtures in each implementation. Share Swift code through an extension-safe target/module where capabilities allow; keep UI/runtime-specific adapters native.

**Done when:** generated artifacts carry a source hash, drift fails CI, every parser passes the same corpus, and duplicate hand-maintained registries are deleted.

### AUD-018 — Worker is small but combines trust, AI, media, and fallback policy

**Priority:** P2 — edge reliability/security
**Evidence:** one Worker fetch handler owns CORS/auth, TTS, playability, transcript discovery, caption selection, and error mapping. Allowed browser origins can bypass secret auth, caption selection falls to another track without a structured notice, and there are no Worker tests or action-specific rate limits.
**Impact:** a small deployment artifact still has a large responsibility/security surface and opaque quota behavior.

**Implementation specification:** split routing, auth/origin validation, TTS, playability, and transcript services; validate inputs and cap batches/body sizes; require server-issued scope for privileged actions; add per-action quotas, request IDs, structured logs, and visible fallback envelopes. Test with Miniflare/Wrangler for unauthorized origin, expired token, upstream timeout, alternate caption selection, malformed batch, and quota exhaustion.

**Done when:** every action has an explicit auth/quota/schema policy, tests run locally/CI, and every alternate result carries a visible diagnostic.

### AUD-019 — Logging is numerous but not consistently useful or private

**Priority:** P2 — observability
**Evidence:** repository scans find roughly 153 web `console` calls, 196 server calls, 98 Swift `print` calls, plus extension/Worker logs. Server uses pino in places, while libraries and clients use ad hoc strings. Correlation and redaction are inconsistent.
**Impact:** high log volume does not guarantee incident traceability and may expose words, URLs, or identifiers.

**Implementation specification:** define structured event names/levels and a shared correlation ID from UI through API/socket/Worker. Use pino child loggers server-side and privacy-aware `Logger`/OSLog categories on Apple platforms. Centralize redaction, sampling, and retention. Diagnostics shown to users should reference the correlation ID without exposing secrets.

**Done when:** representative lookup/call/study flows can be traced end to end, production builds have no stray debug prints, and automated tests assert secret/token redaction.

### AUD-020 — Migration and generated-project safeguards are incomplete

**Priority:** P2 — operability
**Evidence:** 30 migrations record version/name but no checksum, duplicate/gap protection, or schema verification. The baseline bootstrap marks itself applied when `users` exists, which can bless a partial legacy schema. Both `ios/project.yml` and generated `.xcodeproj` are tracked without a working documented drift check; a temporary out-of-tree generation attempt failed because the destination layout was not prepared. Render uses `npm install` rather than reproducible `npm ci`, and package Node engines are unspecified.
**Impact:** edited migrations, partial databases, project-file drift, and environment-dependent deploys can fail late.

**Implementation specification:** add a migration manifest/checksum, reject duplicates/gaps/changed applied files, and run schema invariants after baseline detection. Test fresh and representative legacy upgrades in disposable PostgreSQL. Decide that `project.yml` is authoritative, provide a supported regeneration command, and fail CI on generated diff. Pin Node engines and use lockfile-driven clean installs/build stages. Document backups for destructive migrations.

**Done when:** migration mutation/partial-schema tests fail safely, fresh/upgrade smoke tests pass, Xcode generation is reproducible with no diff, and deployment uses pinned clean installs.

### AUD-021 — Dead-code and deletion candidates are accumulating

**Priority:** P3 — bloat
**Evidence:** reference scans found exports with no caller beyond their definition/export: web `getClassroom`, `getPendingClasswork`, `getNewToday`, `isOfflineModeEnabled`, `getVideos`, `synthesizeVoicePracticeFeedback`, `renderCloze`; server `isFormOf`, `extractFormOfLemma`, `callImagen`, `getZipf`, `getTeacherDefaultClassroom`, `lookupWordsForPost`, `searchYouTubeChannels`, `emitToUserExcept`; Swift `renderCloze`. `PracticeHubView` is unreferenced. `BrowseView` is unreferenced, although its file also contains live `ChannelDetailView`/`LessonDetailView`. Root `check_word.js` is a hard-coded one-off database query. Commented-out constants/helpers remain.
**Impact:** misleading surface area and extra paths future changes appear obligated to preserve.

**Implementation specification:** verify each candidate with runtime/selector/string references and one clean build/test, then delete rather than deprecate private unused code. Remove only the obsolete `BrowseView` section and split/rename the file containing live detail views. Delete hard-coded one-off scripts or convert genuinely reusable operations into parameterized, documented tools.

**Done when:** every candidate is either deleted or has a documented caller/owner, builds/tests remain green, and no empty compatibility wrapper remains.

### AUD-022 — Tooling and prototype files are not organized as maintained products

**Priority:** P3 — repository hygiene
**Evidence:** `scripts/enrich-a1.mjs` imports `callGemini` and `fetchWordImage` from `server/enrichWord.js`, which does not export them; their implementations live in `server/lib/gemini.js` and `server/lib/imageSearch.js`. Python WSD scripts repeat training/CLI patterns without a requirements/pyproject lock. `srs-sandbox.html` and `vlc/` are prototypes at production-root level. The research Shorts simulator embeds a large catalog also stored as data.
**Impact:** support scripts rot unnoticed, onboarding is unclear, and generated research payloads are tracked twice.

**Implementation specification:** fix enrichment imports and add a no-write smoke/dry-run test. Move maintained tools under `tools/<domain>` with shared CLI/config, locked dependencies, README, owner, and expected outputs. Move prototypes under `prototypes/` with status headers or delete them. Generate the simulator from the source catalog and keep one source of truth.

**Done when:** every executable tool has `--help` and a safe smoke path, dependencies install reproducibly, prototypes are clearly non-production, and duplicated generated data is absent.

### AUD-023 — Local generated artifacts dominate disk usage

**Priority:** P3 — developer experience
**Evidence:** the repository working directory is about 10 GB, dominated by 20 ignored `ios/build-*` derived-data directories totaling roughly 9.5 GB. Tracked source/data is comparatively small; current `node_modules` trees add roughly 546 MB across client/server/Worker.
**Impact:** disk pressure, slower search/indexing/backups, and confusing perceptions of repository bloat. This is workspace bloat, not Git history bloat (`.git` is small).

**Implementation specification:** standardize Xcode builds on one ignored `.derived-data` location (or `/tmp`), document cleanup and size inspection, and provide an explicit cleanup script that lists targets/size and requires confirmation before deletion. Keep caches outside the repo when possible. Do not delete user artifacts automatically.

**Done when:** normal build/test commands reuse one derived-data directory, cleanup is safe and documented, and the repository root stays below an agreed clean-workspace threshold.

### AUD-024 — Root-level quality ownership and documentation are fragmented

**Priority:** P3 — maintainability
**Evidence:** there is no root package/task runner, CI directory, lint/format policy, dependency-update configuration, architecture map, or release checklist. Test commands and platform assumptions are discoverable only by inspection. `project.yml`, Render, Worker, extension, and web/server packages encode independent versions and requirements.
**Impact:** future AI-assisted changes are likely to repeat logic or skip a platform because the repository does not make the complete change surface explicit.

**Implementation specification:** add a concise architecture/ownership document and root commands for setup, check, format, audit, generate, and clean. Document which changes require web/iOS/widget/extension/Worker contract updates. Add a version/release policy and automated dependency PRs. Prefer enforceable scripts/tests over long prose.

**Done when:** a new contributor can run the complete check from a clean clone, release requirements are machine-checkable, and cross-platform change ownership is explicit.

## Recommended target architecture

The project does not need microservices. A tighter modular monolith is the appropriate end state:

```text
Canonical schemas + fixtures + generated registries
                 |
     Express application / domain services
       | PostgreSQL repositories | Redis cache/socket adapters
       | privileged Worker client | media/AI adapters
                 |
  web app       iOS app/widget       extension
  native UI     native UI            page integration
  thin APIs     thin APIs            thin message router
```

Rules for the target state:

- The server owns authoritative study transitions, authorization, privileged credentials, quotas, and durable state.
- Clients own presentation, local/offline capability, and optimistic state only where canonical fixtures prove equivalence.
- The Worker is a narrowly scoped privileged adapter, not an alternate unauthenticated backend.
- PostgreSQL queries paginate at the database; Redis is an optimization with explicit versioning and visible degraded behavior.
- Every fallback is a first-class result with a stable code, correlation ID, structured log, and relevant UI presentation.
- Shared behavior across languages is synchronized through schemas, generated data, and golden fixtures—not a universal cross-language runtime.

## Consolidation and deletion map

| Keep and strengthen | Combine/extract | Delete after verification |
|---|---|---|
| server SRS transition as authority | server route error/validation/diagnostic mapping | unused exports listed in AUD-021 |
| global web fallback presenter | canonical fallback envelope across all surfaces | embedded client Worker secret and old value |
| platform-native transcript renderers | shared transcript/language golden fixtures | `PracticeHubView`; obsolete `BrowseView` section |
| feature-specific CSS | shared navigation/modal/card primitives | hard-coded `check_word.js` |
| native Swift UI | extension-safe Swift transport/keychain/snapshot module | unused `@xenova/transformers` dependency tree |
| one canonical research catalog | generated simulator output | commented dead constants/helpers |
| one XcodeGen spec as authority | domain API services around one transport core | extra local derived-data directories after confirmation |

## Sequenced implementation plan

### Phase 0 — contain exposure (same day)

1. Rotate/remove the compiled Worker secret; restrict Worker and API/Socket origins.
2. Patch the extension toast injection.
3. Remove the unused ML dependency and patch reachable critical dependencies.
4. Document the current Group Call worktree as blocked until its provider/state machine is integrated.

### Phase 1 — establish a truthful green baseline (1–3 days)

1. Fix TypeScript errors and wire every existing test/build into one root check.
2. Resolve the iOS SRS test against `FLASHCARDS.md`; isolate deterministic UI fixtures from live-media smoke tests.
3. Add Worker tests and migration smoke tests.
4. Enforce structured, visible fallback diagnostics; eliminate empty runtime catches.

### Phase 2 — restore single-source behavior (3–7 days)

1. Define API/diagnostic schemas and generated TS/Swift models.
2. Add SRS, transcript, tokenization, and language golden fixtures.
3. Fix stages 4–20 in web and reconcile offline/iOS behavior.
4. Restrict mutation retries to idempotency-safe operations.

### Phase 3 — fix hot pipelines (1–2 weeks)

1. Move dictionary scheduling out of reads; benchmark representative users.
2. Implement SQL-backed grouped pagination and remove/bound the process cache.
3. Lazy-load frequency data; replace Redis startup `KEYS`/flush with versioned namespaces.
4. Lazy-load web routes/styles and introduce bundle budgets.

### Phase 4 — modularize without changing behavior (incremental)

1. Extract the large files in AUD-016 behind their new tests.
2. Centralize route validation/error mapping and split domain services.
3. Remove verified dead code, repair tools, organize prototypes, and make Xcode generation reproducible.
4. Add structured observability and a release/ownership map.

## Suggested success metrics

- zero privileged secrets in distributed artifacts; explicit origin/role authorization tests
- zero TypeScript/Swift build warnings selected as release blockers; all deterministic tests green
- zero undocumented or invisible fallback paths; every injected fallback produces a UI notice and correlated log
- identical SRS golden results on server, web/offline, and iOS for stages 0–20
- dictionary GET paths perform no writes and page memory/row reads remain bounded
- no Redis `KEYS` at runtime startup and warm-cache survival across deploys
- route-level web code splitting with no oversized entry-chunk warning
- no critical/high reachable production advisory without a named, expiring exception
- one reproducible clean-clone command for all project surfaces

## Validation notes

The baseline findings are retained as dated evidence and therefore describe the pre-remediation tree in the present tense. Production source was subsequently refactored according to the specifications above; the live completion state is authoritative in `IMPLEMENTATION_CHECKLIST.md`. Dependency advisory counts in the baseline are historical, while the current release gate and SBOM policy enforce the remediated state. Timing and memory figures are local regression signals, not production service-level measurements. AUD-001 remains visibly open: a private Render probe showed the live Worker returns `403 Unauthorized` to the new scoped token, proving the Worker deployment/rotation is still required.
