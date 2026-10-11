# Launch audit — findings register

Baseline: `main` @ c6375d2. Payments: manual mobile money only; Stripe is intentionally OFF (future work).

## Verification evidence (disposable local Postgres 16 + Supabase stand-ins, all 37 migrations applied)
- `rls_security_test_matrix.sql` 115/115, `payments_security_tests.sql` 124/124, `privileged_column_guard_tests.sql` 19/19.
- Vulnerabilities F-09 / F-12 reproduced on the pre-fix schema, blocked after.
- `npm run lint`, `build`, three bundle/secret scans pass. `npm test`: 306 pass, 2 fail (organizations.test.ts needs a live Supabase endpoint — environment, not code).
- NOT verified here: real Supabase project, live site, mobile/device, GitHub Actions run. CI must be green before launch.

## Register
| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| F-12 | P0 | Signup `options.data.primaryRole` was copied into `users.primary_role`; anyone could register as `platform_admin`. | FIXED 20261012110000 |
| F-09 | P0 | `users` self-UPDATE could set `system_role`/`primary_role`=`platform_admin`, `account_status`. | FIXED 20261012100000 |
| F-10 | P0 | Org admins could self-verify an org / badge; any user could insert a pre-verified org. | FIXED 20261012100000 |
| F-08 | P1 | Anyone (anon) could read every org's tax ID, registration no., contact email/phone, settings. | FIXED 20261012120000 (column privileges + members/admin-only RPC; services updated) |
| F-06 | P1 | `npm start` crashed: server bundle read `import.meta.env` (undefined in CJS). Reproduced. | FIXED (esbuild define) |
| F-01 | P1 | Client called root-relative `/api/...`; unusable on GitHub Pages. | FIXED in code: `VITE_API_BASE_URL` + server `ALLOWED_ORIGINS` CORS allowlist. **Requires an Express backend to be deployed — owner action.** |
| F-02 | P1 | PWA scope/start_url/icons absolute `/`. | FIXED |
| F-03 | P1 | Pages deploy silently published a seed-data demo build when secrets were missing; no checks. | FIXED: fails closed unless repo variable `ALLOW_DEMO_BUILD=true`; adds tsc + bundle scans |
| F-04 | P1 | Stripe webhook accepted unsigned events. | FIXED; Stripe routes now 503 unless `ENABLE_STRIPE=true` |
| F-05 | P2 | Stripe checkout membership check used demo store; unvalidated price/redirect/customer. | DEFERRED — routes disabled by default; must be redesigned before Stripe is enabled |
| F-07 | P2 | Default MoMo numbers/account name baked into Pages build. | ACCEPTED — they are the public payment destination; override with repo variables VITE_MOMO_* |
| F-11 | P1 | No `verification_officer` role in DB; only `platform_admin` can review. | OPEN — business decision (safe default: fewer privileges) |

## Payment (mobile money) review — no code defects found
Server-authoritative pricing, no direct writes to payments/subscriptions, admin-only approval, no double approval, one open payment per vacancy/listing/org subscription, unique live provider transaction id, reference format hardening, expiry, org isolation, publication gated on approval — all covered by the 124 payment assertions. Process note: approval is a manual admin judgement against the MoMo statement; there is no "amount received" field, so reconcile statements periodically.

## REQUIRED owner actions before launch
1. Apply migrations 20261012100000, …110000, …120000 (CI applies them to a disposable DB automatically).
2. **Review existing accounts** — F-09/F-12 may already have been exploited:
   `select id, email, primary_role, system_role, created_at from public.users where primary_role in ('platform_admin','verification_officer') or system_role <> 'user' order by created_at;`
   Demote anything unexpected (run as service role / SQL editor). Also review `organizations` with `verification_status='verified'` that never went through a review, and recent `payments`/`organization_subscriptions` approvals.
3. Deploy the Express backend somewhere with a public HTTPS URL; set `ALLOWED_ORIGINS=https://zeahn-tech.github.io`, `GEMINI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; set repo variable `VITE_API_BASE_URL=https://<backend>/api`. Without it, AI features are unavailable (the app degrades gracefully).
4. Confirm `SUPABASE_PAGES_URL` / `SUPABASE_PAGES_ANON_KEY` repo secrets exist and Supabase Auth redirect URLs include `https://zeahn-tech.github.io/LibRise/`.
5. Contact email/phone of organizations is now private (members/admins only). If you want a public contact email on org pages, re-grant that single column in a new migration and add it to `ORG_PUBLIC_COLUMNS` (a unit test keeps the two in sync).
