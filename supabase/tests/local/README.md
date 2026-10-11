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
