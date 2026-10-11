#!/usr/bin/env bash
# Disposable-database test run: applies EVERY migration (with Supabase stand-ins), then
# runs the pgTAP suites and, if POSTGREST_BIN is set, the HTTP authorization checks.
# NEVER point this at a real/production database: it DROPS and recreates $DB.
#
#   PGHOST=/tmp PGPORT=54399 PGUSER=postgres ./supabase/tests/local/run.sh
# Needs: a local PostgreSQL 15+ with the pgtap extension, psql on PATH.
# Optional: POSTGREST_BIN=/path/to/postgrest (https://github.com/PostgREST/postgrest/releases)
set -uo pipefail
DB="${DB:-librise_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
case "${PGHOST:-}" in *supabase.co*|*supabase.com*|*amazonaws*) echo "Refusing to run against a hosted database."; exit 2;; esac
P=(psql -X -q -v ON_ERROR_STOP=1)
dropdb --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
"${P[@]}" -d "$DB" -f "$HERE/stub.sql" 2>&1 | grep -v "WARNING\|HINT\|NOTICE"
psql -X -q -d "$DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
fail=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${P[@]}" -d "$DB" -f "$f" >"${TMPDIR:-/tmp}/mig.$$.out" 2>&1 || { echo "MIGRATION FAILED: $(basename "$f")"; grep ERROR "${TMPDIR:-/tmp}/mig.$$.out" | head -2; exit 1; }
done
echo "migrations applied: $(ls "$ROOT"/supabase/migrations/*.sql | wc -l)"
for t in "$ROOT"/supabase/tests/*.sql; do
  out=$(psql -X -t -A -d "$DB" -v ON_ERROR_STOP=1 -f "$t" 2>&1); rc=$?
  total=$(echo "$out" | grep -cE '^(ok|not ok) '); bad=$(echo "$out" | grep -cE '^not ok ')
  echo "$(basename "$t"): exit=$rc total=$total failed=$bad"; { [ $rc -ne 0 ] || [ "$bad" -ne 0 ]; } && { fail=1; echo "$out" | grep -E '^not ok |ERROR' | head -5; }
done
if [ -n "${POSTGREST_BIN:-}" ]; then
  psql -X -q -d "$DB" -f "$HERE/seed_http.sql"
  CONF=$(mktemp); LOGF=$(mktemp)
  cat >"$CONF" <<CONF
db-uri = "postgres://authenticator:pw@127.0.0.1:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-port = 3999
CONF
  "$POSTGREST_BIN" "$CONF" >"$LOGF" 2>&1 & PR=$!; sleep 3
  python3 "$HERE/http_authz_check.py" | tail -3; [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1; kill $PR 2>/dev/null
fi
exit $fail
