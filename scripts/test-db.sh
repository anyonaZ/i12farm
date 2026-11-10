#!/usr/bin/env bash
# Apply every migration + the dev seed to a throwaway database, then run the
# schema and security tests.
#
#   DATABASE_URL=postgres://... scripts/test-db.sh   # real Postgres + PostGIS (CI, local)
#   scripts/test-db.sh --standin                     # no PostGIS available: temp cluster + text stand-in
#
# DATABASE_URL must point at a server where you may create databases; the
# tests run in a fresh database called i12farm_test that is dropped first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$ROOT/db/migrations"
TESTS="$ROOT/db/tests"
WORK="$(mktemp -d)"
trap 'cleanup' EXIT
cleanup() {
  if [[ -n "${PGCTL_DATA:-}" ]]; then
    su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$PGCTL_DATA' -m fast stop" >/dev/null 2>&1 || \
      /usr/lib/postgresql/16/bin/pg_ctl -D "$PGCTL_DATA" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}

STANDIN=0
[[ "${1:-}" == "--standin" ]] && STANDIN=1

if [[ $STANDIN -eq 1 ]]; then
  PGBIN=/usr/lib/postgresql/16/bin
  PGCTL_DATA="$WORK/data"
  mkdir -p "$PGCTL_DATA"
  RUN=()
  if [[ $(id -u) -eq 0 ]]; then chown -R postgres "$WORK"; RUN=(su postgres -c); fi
  run() { if [[ ${#RUN[@]} -gt 0 ]]; then "${RUN[@]}" "$*"; else bash -c "$*"; fi; }
  run "$PGBIN/initdb -D '$PGCTL_DATA' -U postgres -A trust >/dev/null"
  run "$PGBIN/pg_ctl -D '$PGCTL_DATA' -o '-p 54329 -k $WORK' -l '$WORK/pg.log' -w start >/dev/null"
  DATABASE_URL="postgresql://postgres@localhost:54329/postgres?host=$WORK"
fi

: "${DATABASE_URL:?set DATABASE_URL or pass --standin}"

if [[ $STANDIN -eq 0 ]]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -c 'drop database if exists i12farm_test' -c 'create database i12farm_test'
  DATABASE_URL="$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(u.urlunsplit(p._replace(path="/i12farm_test")))' "$DATABASE_URL")"
  # Some PostGIS images pre-install the extension into public; we keep it in "extensions".
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -c 'drop extension if exists postgis cascade'
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)

if [[ $STANDIN -eq 1 ]]; then
  echo "→ PostGIS text stand-in (local only)"
  "${PSQL[@]}" -c 'create schema if not exists extensions'
  "${PSQL[@]}" -f "$TESTS/postgis_standin.sql"
fi

for f in "$MIG"/*.sql; do
  echo "→ $(basename "$f")"
  if [[ $STANDIN -eq 1 ]]; then
    sed -E \
      -e '/create extension if not exists postgis/d' \
      -e 's/geography\(Point, 4326\)/geography/g' \
      -e '/using gist \(public_location\)/d' \
      "$f" > "$WORK/m.sql"
    "${PSQL[@]}" -f "$WORK/m.sql"
  else
    "${PSQL[@]}" -1 -f "$f"
  fi
done

echo "→ seed.sql"
"${PSQL[@]}" -f "$ROOT/db/seed.sql"

echo "→ security tests"
"${PSQL[@]}" -f "$TESTS/security_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'

if [[ -f "$TESTS/trade_test.sql" ]]; then
  echo "→ trade tests"
  "${PSQL[@]}" -f "$TESTS/trade_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/phase2b_test.sql" ]]; then
  echo "→ phase 2b tests"
  "${PSQL[@]}" -f "$TESTS/phase2b_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/vets_test.sql" ]]; then
  echo "→ vet request tests"
  "${PSQL[@]}" -f "$TESTS/vets_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/hardening_test.sql" ]]; then
  echo "→ phase 3.5 tests"
  "${PSQL[@]}" -f "$TESTS/hardening_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/insight_test.sql" ]]; then
  echo "→ phase 4 insight tests"
  "${PSQL[@]}" -f "$TESTS/insight_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/pesi_test.sql" ]]; then
  echo "→ Pesi payment tests"
  "${PSQL[@]}" -f "$TESTS/pesi_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

if [[ -f "$TESTS/safety_test.sql" ]]; then
  echo "→ Phase 6 notification and safety tests"
  "${PSQL[@]}" -f "$TESTS/safety_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p; /ERROR/p; /passed/p'
fi

echo "→ seed_demo.sql (applies cleanly on top)"
"${PSQL[@]}" -f "$ROOT/db/seed_demo.sql"
"${PSQL[@]}" -t -c "select 'published farms: ' || count(*) from public.farms where status = 'published'"
