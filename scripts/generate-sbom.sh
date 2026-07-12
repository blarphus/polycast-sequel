#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${1:-$ROOT/artifacts/sbom}"
mkdir -p "$OUTPUT"

for project in client server extension cf-worker; do
  (cd "$ROOT/$project" && npm sbom --package-lock-only --omit=dev --sbom-format=cyclonedx) \
    > "$OUTPUT/$project.cdx.json"
  node -e "const value=require(process.argv[1]); if (value.bomFormat !== 'CycloneDX') process.exit(1)" \
    "$OUTPUT/$project.cdx.json"
done

printf 'Generated production CycloneDX SBOMs in %s\n' "$OUTPUT"
