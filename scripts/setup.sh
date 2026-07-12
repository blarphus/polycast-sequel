#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
required_node="$(cat "$ROOT/.node-version")"
actual_node="$(node -p 'process.versions.node')"
if [[ "$actual_node" != "$required_node" ]]; then
  echo "Node $required_node is required; current Node is $actual_node." >&2
  exit 1
fi
command -v xcodegen >/dev/null || { echo 'xcodegen is required (brew install xcodegen).' >&2; exit 1; }

(cd "$ROOT" && npm ci)
for project in client server extension cf-worker; do
  (cd "$ROOT/$project" && npm ci)
done
(cd "$ROOT/ios" && xcodegen generate)
node "$ROOT/scripts/generate-contracts.mjs" --check
echo 'Polycast workspace setup complete.'
