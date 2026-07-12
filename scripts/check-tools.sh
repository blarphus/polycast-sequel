#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node "$ROOT/scripts/enrich-a1.mjs" --help >/dev/null
NODE_ENV=test JWT_SECRET=tool-smoke-secret node "$ROOT/scripts/enrich-a1.mjs" --smoke
node "$ROOT/tools/research/normalize-shorts-simulator.mjs" --help >/dev/null
node "$ROOT/tools/research/normalize-shorts-simulator.mjs" --check

for tool in \
  "$ROOT/scripts/build-catalog.mjs" \
  "$ROOT/scripts/categorize-lessons.mjs" \
  "$ROOT/server/scripts/backfillImages.js" \
  "$ROOT/server/scripts/backfillSentenceTranslations.js" \
  "$ROOT/server/scripts/benchmarkGeminiWsd.js" \
  "$ROOT/server/scripts/extractWsdTrainingData.js" \
  "$ROOT/server/scripts/importWiktionary.js" \
  "$ROOT/server/scripts/precomputeTranslations.js" \
  "$ROOT/server/scripts/recacheDeadImages.js" \
  "$ROOT/server/scripts/migrationSmoke.js" \
  "$ROOT/server/scripts/legacyMigrationSmoke.js" \
  "$ROOT/server/scripts/startupBenchmark.js"; do
  node "$tool" --help >/dev/null
done
python3 "$ROOT/server/scripts/exportWordfreq.py" --help >/dev/null
python3 "$ROOT/server/scripts/generateSubtitles.py" --help >/dev/null

for script in "$ROOT"/scripts/*.mjs "$ROOT"/server/scripts/*.js; do
  node --check "$script"
done
for script in "$ROOT"/server/scripts/*.py "$ROOT"/tools/wsd/*.py; do
  PYTHONPYCACHEPREFIX=/tmp/polycast-python-cache python3 -m py_compile "$script"
done
echo 'Maintained tool syntax and safe smoke checks passed.'
