#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d /tmp/polycast-xcodegen.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/ios"
cp "$ROOT/ios/project.yml" "$TMP/ios/project.yml"
cp -R "$ROOT/ios/Polycast" "$TMP/ios/Polycast"
cp -R "$ROOT/ios/PolycastWidget" "$TMP/ios/PolycastWidget"
(cd "$TMP/ios" && xcodegen generate --spec project.yml >/dev/null)
diff -u \
  "$ROOT/ios/Polycast.xcodeproj/project.pbxproj" \
  "$TMP/ios/Polycast.xcodeproj/project.pbxproj"
