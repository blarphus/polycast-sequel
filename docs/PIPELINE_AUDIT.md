# End-to-end pipeline audit ledger

This ledger records the post-refactor owner, intentional primary path, bounded alternates, diagnostics, and acceptance evidence for every product pipeline. A fallback is never relabeled as success: every retained alternate uses the canonical diagnostic envelope and reaches the relevant UI.

## Authentication and profile sessions

- Owners: server auth/profile-session services and one shared HTTP/Socket.IO origin policy; web `AuthProvider`; iOS `SessionStore`; extension background session store.
- Primary: credential exchange → revocable server session → platform token store → `/me` restore → explicit logout/revoke.
- Alternates: authenticated 401 performs one deduplicated teardown. Anonymous startup probing is not classified as session expiry. Cached extension status is explicitly offline.
- Diagnostics: `session_expired`, `extension_session_expired`, and cached/offline status codes carry the request correlation ID; credentials are redacted.
- Evidence: auth integration/session-expiration tests on server, web, extension, and Swift; profile switching is bound to opaque server-side sessions.

## Dictionary lookup, enrichment, images, save, and offline sync

- Owners: semantic/media/word services and thin dictionary routers; web/extension/iOS adapters own only transport/UI state.
- Primary: local senses + bounded sense selection → translation/enrichment → parallel image-provider search → one save service → explicit schedule refresh.
- Alternates: full semantic provider after a local-sense miss, generated image after no suitable stock image, one image provider after the other fails, and offline extension/web storage when live account access is unavailable.
- Diagnostics: semantic, image-provider, generation, storage-repair, and offline codes are normalized by response middleware or platform presenters.
- Efficiency: duplicate save returns the existing row without duplicate XP; surface forms merge in the service; images and shared entries are cached once.
- Evidence: word/media service tests, hostile extension popup tests, exact API fixtures, and fallback inventory.

## Study scheduling, review, and stage sentences

- Owners: server schedule/study query modules and study service; generated SRS constants/fixtures define cross-platform behavior.
- Primary: pure due/new projection → explicit day-boundary/dirty repair → idempotent review mutation → optional high-stage sentence generation.
- Alternates: failed stage-sentence generation keeps the production prompt layout and emits `stage_sentence_generation_fallback`; no read route performs hidden scheduling writes.
- Efficiency: one advisory-locked repair, bounded daily limits, one transaction for reorder, one idempotency record for review.
- Evidence: server/Swift/web SRS golden tests, query-shape tests, lost-response replay tests, and real PostgreSQL migration/paging tests.

## Dictionary grouping, search, pagination, calendar, and widget preview

- Owners: separate group/calendar/study query modules behind `dictionaryStudyService`.
- Primary: indexed SQL filtering/sorting → stable context-bound keyset cursor → `limit + 1` page → compact response.
- Alternates: invalid/stale cursors fail visibly; schedule repair is explicit and diagnostic-bearing.
- Efficiency: no full dictionary materialization; widget preview performs two bounded parallel reads; all six sorts use database ordering.
- Evidence: query tests plus the 10k-word PostgreSQL latency/heap/no-gap integration test.

## Video discovery, channels, lessons, Shorts, and playability

- Owners: thin video router, catalog service, media Worker service; web and iOS feature views.
- Primary: language/region catalog query → bounded provider fetch/cache → server playability batch → filtered UI.
- Alternates: unfiltered channel/lesson results and provider failures remain visible; Shorts cursor state has one owner per platform.
- Efficiency: one playability batch (maximum 50 IDs), no route-local retry loops, lazy web route/CSS, extracted iOS Shorts lifecycle.
- Evidence: Worker bounds/fault tests, route registry, web bundle budget, and iOS build.

## Transcript acquisition and rendering

- Owners: transcript queue/service, private Worker, platform-native renderers, canonical transcript/token corpus.
- Primary: existing transcript → queued provider extraction → Worker timed captions → persisted normalized segments → renderer.
- Alternates: server YouTube transcript providers after Worker failure, first available caption language, and client-assisted upload; each includes provider/reason/correlation. The route excludes the Worker from its alternate chain after a primary Worker failure, while queue-owned extraction may select it once.
- Efficiency: one scoped HMAC Worker authority, bounded request/body/time limits, deduplicated queue work, exact segment schema, no repeated Worker attempt or tokenization transform.
- Evidence: Worker provider/timeout/language tests and shared web/extension/Swift corpus tests.

## TTS and voice practice

- Owners: server TTS/voice-practice services; platform audio players own playback only.
- Primary: supported private Worker voice through the same scoped HMAC authority → cached word audio or streamed exercise audio.
- Alternates: OpenAI for unsupported languages, no-audio card continuation, and vocabulary meaning questions when fresh sentence/image inputs are unavailable.
- Diagnostics: compatibility TTS header is retained, but the canonical detailed fallback header/body is authoritative and visible.
- Efficiency: word audio is generated and stored once; preloads are bounded/cancellable; practice generation uses bounded parallel work.
- Evidence: TTS scoped-token service tests, static Worker-auth regression gate, 53-code fallback inventory, practice fallback tests, and audio UI presenters.

## Direct calls

- Owners: app-level `CallProvider`, server signaling validator, WebRTC/transcription components.
- Primary: call record → strict correlated offer/answer/ICE → verified active peer → media/transcription → explicit end.
- Alternates: unavailable/stale/mismatched peers and malformed signaling are rejected, logged, and shown; screen-share restoration failures are visible.
- Efficiency: one provider survives navigation, listener/media teardown is centralized, mutations are not implicitly retried.
- Evidence: signaling contract tests, correlation tests, and call lifecycle checks.

## Group calls

- Owners: app-shell `GroupCallProvider`, server room state machine, per-page renderer.
- Primary: one REST join → one socket room/media join → strict peer signaling → navigation-safe minimized tile → explicit leave.
- Alternates: reconnect rejoins signaling without duplicate REST/media state; stale rooms/malformed messages are rejected visibly.
- Efficiency: participant dedupe, cancellation on room switch, pagehide/logout teardown, no duplicate listeners/tracks.
- Evidence: provider/lifecycle/socket tests.

## EPUB and local video

- Owners: web EPUB/local-video stores and route views; iOS dead local-media chain was removed after caller verification.
- Primary: explicit user import/directory permission → local persistence → parser/player → saved progress → shared lookup UI.
- Alternates: sentence segmenter and directory restore failures are visible and logged; permission cancellation does not masquerade as success.
- Efficiency: file handles and parsed chapters are cached, cleanup is user-driven, and no unused native duplicate remains.
- Evidence: EPUB tests, local fallback inventory, and zero-caller inventory.

## Classroom and classwork

- Owners: classroom/classwork services; routers authenticate, validate, normalize, and delegate.
- Primary: role/membership authorization → service transaction/query → exact response.
- Alternates: legacy endpoints resolve an explicit classroom ID through the same authorization service; conflicts and forbidden/not-found states are typed central errors.
- Efficiency: duplicated route try/catch/error mapping was removed; no teacher-wide implicit classroom fallback remains.
- Evidence: auth integration tests, unique route registry, and centralized error tests.

## Browser extension

- Owners: generated message contract/router, activation module, background session dispatcher, isolated content-script lifecycles.
- Primary: exact page permission/registration → language detection → indexed token match → popup lookup/save → account sync.
- Alternates: declared language, DOM-range highlighting, top-frame selection, offline dictionary/status, and delivery failure are all visible. Background-only failures persist to popup storage and action badge/title.
- Efficiency: one saved-token index, bounded message sizes/token batches, no HTML injection, no duplicate site registration.
- Evidence: activation, performance, hostile-toast, session-expiry, contract, and tokenizer tests.

## iOS widget

- Owners: shared snapshot/store contract; separate intent, provider/API/cache, view, and registration files.
- Primary: shared Keychain token → compact widget preview → bounded image cache → timeline → intent paging.
- Alternates: cached snapshot and missing-token paths remain OSLog-visible and show the widget’s explicit stale/empty state.
- Efficiency: one compact request, thumbnail bounds, refresh gate, shared snapshot code instead of an app/widget copy.
- Evidence: app+widget simulator build, XcodeGen drift gate, Swift contract/fallback tests.

## Startup, migrations, caches, and deployment

- Owners: root release scripts, immutable migration manifest, server startup/cache modules, deployment docs.
- Primary: environment validation → contiguous migrations → versioned Redis/cache startup → server listen/background workers.
- Alternates: unavailable Redis/provider/configuration paths are diagnostic-bearing; no blanket cache flush or hidden migration mutation.
- Efficiency: lazy bounded frequency maps, dynamic article parser import, no Redis `KEYS`, startup latency/RSS budgets.
- Evidence: fresh/legacy migration smoke, startup benchmark, dependency/SBOM gates, Worker dry deploy, and root check orchestration.
