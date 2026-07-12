# Architecture and ownership

Polycast is a modular monolith with platform clients. PostgreSQL is authoritative for user/domain data; Redis is a cache, presence store, and transcript queue. The server is the only public client allowed to mint short-lived media Worker credentials.

| Surface | Owns | Must not own |
|---|---|---|
| `contracts/` + generated outputs | External payloads, SRS constants/fixtures, language registry | Runtime side effects |
| `client/` | Web UI, browser media lifecycle, explicit offline dictionary | Server authorization or shared secret material |
| `server/` | Authentication/roles, domain mutations, SQL, integrations, Worker token minting | Platform UI state |
| `ios/` | Native UI/media, local caches, widget-safe shared snapshot code | Independent SRS/API registries |
| `extension/` | User-granted page activation, isolated lookup UI, bounded offline bridge | Blanket ordinary-site access or trusted authorization decisions |
| `cf-worker/` | Scoped media/TTS operations, replay/quota enforcement | User sessions or long-lived browser credentials |
| `tools/` | Maintained, documented offline tooling | Production imports |
| `prototypes/` and `research/` | Explicitly non-production experiments/data investigations | Release dependencies |

## Pipeline rules

Each invariant has one owner. Routes validate and authorize transport input, services orchestrate domain work, query modules own SQL, and presenters own UI diagnostics. Alternate paths return the versioned fallback diagnostic and remain visible; optimization removes unnecessary alternate conditions, never their notices.

## Cross-platform change matrix

- SRS or prompt-stage changes: update `contracts/srs-v1*`, regenerate, and run server/web/Swift golden tests.
- Auth, transcript, fallback, socket, or extension payload changes: update `contracts/api-v1*`, regenerate, validate server responses, and decode fixtures in web/Swift/extension tests.
- Supported language changes: update `contracts/languages-v1.json`; never edit generated registries.
- Study SQL changes: run pure-read tests, fresh/legacy migrations, the 10k pagination benchmark, web offline fixtures, and iOS/widget tests.
- Call signaling changes: run direct and group state/lifecycle tests and verify logout/reconnect/page-hide cleanup.
- Extension messages or host scope: update boundary validation, malicious-payload tests, optional-origin activation tests, manifest, and `extension/PRIVACY.md`.
- Worker actions: update action policy, server proxy, input limits, quota/replay/timeout/fallback tests, and deployment bindings.
- Widget-visible models: keep target membership explicit and build/test both app and widget.

## Version policy

User-facing web/server/extension/iOS releases use semantic versions and one release note. Contract files have independent integer versions and generated source hashes; breaking payload behavior increments the contract version. Database migrations are immutable and sequential. Cache versions change only for incompatible stored representations. Dependency updates arrive weekly and remain isolated when they cross a major version.
