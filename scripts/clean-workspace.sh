#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$ROOT"/ios/build-*)

if [[ ! -d "${TARGETS[0]}" ]]; then
  echo "No legacy ios/build-* directories found."
  exit 0
fi

du -sh "${TARGETS[@]}"
if [[ "${1:-}" == "--report" ]]; then exit 0; fi

echo
read -r -p "Delete the listed generated build directories? Type DELETE to confirm: " answer
if [[ "$answer" != "DELETE" ]]; then
  echo "No files deleted."
  exit 0
fi
rm -rf -- "${TARGETS[@]}"
echo "Deleted ${#TARGETS[@]} generated build directories."
