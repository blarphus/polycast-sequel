# Deployment and migration runbook

## Reproducible inputs

- Node is pinned to 22.12.0 by `.nvmrc`, `.node-version`, CI, and Render's `NODE_VERSION`.
- Every JavaScript surface installs from its committed lockfile with `npm ci`. Render builds the web app with development tooling, then installs only server production dependencies.
- `ios/project.yml` is authoritative. `npm run check:xcodegen` regenerates the Xcode project and rejects drift. Swift packages use exact versions and the resolved file remains committed.
- Worker builds use the committed Wrangler lockfile and compatibility date. Production cache keys retain the current `CACHE_VERSION`; incrementing it abandons old entries without a blocking key scan or deployment-wide flush.

## Database changes and backups

Every migration has a permanent sequential filename and checksum. Never edit an applied migration; add a new one. Fresh and representative legacy PostgreSQL 16 upgrades run in CI.

Before a migration that drops a table/column, rewrites or deletes user rows, changes an irreversible encoding, or performs a large backfill:

1. Mark the deployment change as destructive in its pull request and name the rollback owner.
2. Take a provider snapshot and a portable `pg_dump --format=custom --no-owner` backup immediately before deployment. Record the snapshot/backup identifier outside the repository.
3. Verify the dump with `pg_restore --list` and retain it through at least one full release cycle.
4. Run the migration against a restored staging copy and record row-count/schema invariants.
5. Deploy one server instance, confirm migration checksums and invariants, then expand traffic.
6. If invariants fail, stop application writers and restore into a new database; do not attempt to reverse a destructive migration in place.

Quarterly, restore the newest backup to an isolated PostgreSQL 16 instance and run `scripts/check-database.sh` with explicit fresh and legacy URLs. A backup without a successful restore drill is not considered deploy evidence.

## Worker trust configuration

The Worker requires `AUTH_SECRET`, an `AUTH_REPLAY` KV binding, `INNERTUBE_API_KEY`, explicit `ALLOWED_ORIGINS`, and the `AI` binding. `AUTH_REPLAY` is declared without an ID so authenticated Wrangler 4 deployment automatically provisions it and writes the account ID back to the configuration. The server's `CF_TRANSCRIPT_WORKER_SECRET` must equal the Worker secret; it is never shipped to web, extension, or iOS clients. Rotate both secret locations together, deploy the Worker first, deploy the server immediately afterward, and confirm old-token rejection plus new-token success in Worker logs. Do not remove replay/quota bindings to make a deployment pass—the Worker intentionally returns a visible `worker_auth_configuration_missing` diagnostic.

`npm run check:worker-auth` and `npm run check:deployment-config` must pass before deployment. They reject distributed signing-secret references, server Worker callers outside the scoped HMAC authority, missing replay/observability bindings, and mismatched production origins; transcript, playability, related-video, and TTS calls must not reintroduce a reusable bearer credential.

## Release verification

Run `npm run check` at the repository root, preserve the CI run and SBOM artifact, verify correlation/redaction tests, then perform authenticated smoke checks for login/session restore, dictionary review, transcript fallback, direct/group call teardown, extension optional-site activation, and widget refresh.
