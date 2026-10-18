# Local disposable-database tests

`run.sh` applies every migration to a throwaway Postgres (Supabase roles/`auth` schema are stubbed in
`stub.sql`), runs all pgTAP suites in `supabase/tests/*.sql`, and optionally runs `http_authz_check.py`
through a local PostgREST (the real HTTP/REST query shapes: `select=*` rejection, escalation attempts, RPC grants).

Test strategy
- **Unit tests** (`npm test`): hermetic; `vite.config.ts` clears `VITE_SUPABASE_*` so no test can reach a network.
- **Database authorization** (`supabase/tests/*.sql`, run in CI against a Supabase-CLI database, and here locally).
- **HTTP authorization** (`http_authz_check.py`): optional, local only.
- Not covered anywhere automatically: real Supabase Auth (GoTrue) flows, email delivery, the live site, mobile devices.

Limitations: `auth.uid()`/roles are stand-ins, GoTrue/Storage/Realtime are absent. CI's Supabase-CLI job remains the source of truth.

`enforcement_route_check.mjs` (run by `run.sh` when `npm run build` has produced `dist/server.cjs` and PostgREST is available) exercises the real Express route `POST /api/admin/auth-enforcement/sync` end to end against the disposable database, with the Supabase Auth service and Admin API replaced by a local stub. It proves the route's authorization, targeting, failure (502/503) and convergence behaviour; it does NOT prove how a hosted Auth service behaves. Port 3000 must be free.

Set `GOTRUE_MIGRATIONS_DIR` (a clone of `github.com/supabase/auth`, `migrations/`) to run everything against the real GoTrue schema instead of the minimal stand-in tables.
