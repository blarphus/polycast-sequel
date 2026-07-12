# Dependency and vulnerability policy

Every JavaScript package installs with `npm ci`, runs its tests/build, and runs `npm audit` in CI. Critical or high production advisories may not be hidden with a blanket audit threshold or ignored exit code.

If an upstream fix is temporarily unavailable, add only the specific advisory to `security/npm-audit-exceptions.json` with the affected project, a named owner, concrete reason, and near-term ISO-8601 expiry. `npm run check:dependency-policy` fails on malformed or expired entries. The exception must be removed as part of the dependency update that resolves it.

`npm run sbom` produces one production-only CycloneDX document per JavaScript surface under `artifacts/sbom`. CI generates and uploads those documents for every accepted change.
