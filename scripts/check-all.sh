#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_IOS="${1:-}"

node "$ROOT/scripts/generate-contracts.mjs" --check
node "$ROOT/scripts/check-fallbacks.mjs"
node "$ROOT/scripts/generate-fallback-inventory.mjs" --check
node "$ROOT/scripts/check-runtime-logging.mjs"
node "$ROOT/scripts/check-worker-auth.mjs"
node "$ROOT/scripts/check-deployment-config.mjs"
node "$ROOT/scripts/check-format.mjs"
bash "$ROOT/scripts/check-tools.sh"
node "$ROOT/scripts/generate-code-inventory.mjs" --check
node "$ROOT/scripts/check-runtime-registrations.mjs"
(cd "$ROOT/client" && npm run check)
(cd "$ROOT/server" && npm run check)
(cd "$ROOT/server" && npm run benchmark:startup)
(cd "$ROOT/extension" && npm run check)
(cd "$ROOT/cf-worker" && npm run check)
"$ROOT/scripts/check-xcodegen.sh"
bash "$ROOT/scripts/check-database.sh"

if [[ "$SKIP_IOS" != "--skip-ios" ]]; then
  xcodebuild \
    -project "$ROOT/ios/Polycast.xcodeproj" \
    -scheme Polycast \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
    -derivedDataPath /tmp/polycast-check-derived-data \
    test \
    CODE_SIGNING_ALLOWED=NO
fi
