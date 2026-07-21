#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_DIR=""
STARTED_POSTGRES=0

find_pg_bin() {
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return; fi
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix postgresql@16 2>/dev/null || true)"
    if [[ -x "$prefix/bin/initdb" ]]; then printf '%s\n' "$prefix/bin"; return; fi
  fi
  return 1
}

cleanup() {
  if [[ "$STARTED_POSTGRES" == 1 ]]; then "$PG_BIN/pg_ctl" -D "$PG_DIR" stop -m fast >/dev/null 2>&1 || true; fi
  if [[ -n "$PG_DIR" ]]; then
    rm -rf "$PG_DIR"
  fi
}
trap cleanup EXIT

if [[ -n "${DATABASE_URL:-}" ]]; then
  FRESH_URL="$DATABASE_URL"
  LEGACY_URL="${LEGACY_DATABASE_URL:-}"
  if [[ -z "$LEGACY_URL" ]]; then
    echo 'LEGACY_DATABASE_URL is required when DATABASE_URL is supplied.' >&2
    exit 1
  fi
else
  PG_BIN="$(find_pg_bin || true)"
  if [[ -z "$PG_BIN" ]]; then
    echo 'PostgreSQL 16 tools are required. Install postgresql@16 or provide DATABASE_URL and LEGACY_DATABASE_URL.' >&2
    exit 1
  fi
  PG_DIR="$(mktemp -d /tmp/polycast-check-pg.XXXXXX)"
  "$PG_BIN/initdb" -D "$PG_DIR" --no-locale --encoding=UTF8 --auth=trust >/dev/null
  PORT=$(( 55432 + (RANDOM % 500) ))
  "$PG_BIN/pg_ctl" -D "$PG_DIR" -o "-p $PORT -h 127.0.0.1" -l "$PG_DIR/postgres.log" start >/dev/null
  STARTED_POSTGRES=1
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" polycast_fresh
  "$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" polycast_legacy
  FRESH_URL="postgresql://127.0.0.1:$PORT/polycast_fresh"
  LEGACY_URL="postgresql://127.0.0.1:$PORT/polycast_legacy"
fi

(cd "$ROOT/server" && DATABASE_URL="$FRESH_URL" NODE_ENV=test JWT_SECRET=polycast-test-secret npm run test:migrations)
(cd "$ROOT/server" && DATABASE_URL="$FRESH_URL" NODE_ENV=test JWT_SECRET=polycast-test-secret npm run test:integration)
(cd "$ROOT/server" && DATABASE_URL="$FRESH_URL" NODE_ENV=test JWT_SECRET=polycast-test-secret npm run test:catalog-backfill)
(cd "$ROOT/server" && DATABASE_URL="$LEGACY_URL" NODE_ENV=test JWT_SECRET=polycast-test-secret node scripts/legacyMigrationSmoke.js)
