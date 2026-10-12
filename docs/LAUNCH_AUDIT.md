# Launch audit — findings register (updated after patch review)

Baseline: `main` @ c6375d2. Payments: manual mobile money only; Stripe is intentionally OFF (future work).

## Verification evidence (disposable local Postgres 16 + Supabase stand-ins; see `supabase/tests/local/README.md`)
- All 42 migrations applied with the **Supabase CLI** (`supabase db push --db-url …`), second push "up to date"; no duplicate versions; every new migration re-runs without error; documented rollbacks execute (transaction-tested); applying the new migrations to a database holding legacy rows left every row and every pre-existing function ACL byte-identical (md5 snapshot).
- pgTAP: `rls_security_test_matrix.sql` 115/115, `payments_security_tests.sql` 124/124, `privileged_column_guard_tests.sql` 41/41, `account_status_enforcement_tests.sql` 47/47, `membership_ownership_tests.sql` 28/28, `candidate_privacy_tests.sql` 21/21.
- Real **PostgREST** HTTP checks (`http_authz_check.py`): 36/36.
- `npm run lint`, `build`, three bundle/secret scans: pass. `npm test -- --run`: 311/311 (with and without `VITE_SUPABASE_*` set).
- NOT verified here: a real Supabase project (GoTrue, Storage, Realtime; stand-in `auth` schema/roles used), the GitHub Actions run (CI starts a real local Supabase and runs all six pgTAP files), server→Supabase JWT validation with real tokens, the live site, mobile/device behaviour, whether any migration was already applied to a real project.

## Register
| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| F-12 | P0 | Signup `options.data.primaryRole` was copied into `users.primary_role`; anyone could register as `platform_admin`. | FIXED 20261012110000 |
| F-09 | P0 | `users` self-UPDATE could set `system_role`/`primary_role`=`platform_admin`, `account_status`. | FIXED 20261012100000 |
| **F-13** | **P0** | **(found in patch review)** `users.email` was still self-editable. Invitations are matched on `users.email`, so a user could set their email to an invitee's, read the invitation token via RLS and `accept_organization_invitation()` it — joining any org with the invited role (incl. `admin`). Reproduced; also `is_email_verified`/`is_phone_verified` were self-assertable. | FIXED 20261012130000 |
| F-10 | P0 | Org admins could self-verify an org / badge; any user could insert a pre-verified org. | FIXED 20261012100000 (INSERT path re-tested: `is_verified=true` in an INSERT payload is overwritten to false by the sync trigger; status/badge inserts rejected) |
| F-08 | P1 | Anyone (anon) could read every org's tax ID, registration no., contact email/phone, settings. | FIXED 20261012120000 (+ 20261012140000: suspended accounts get nothing from the RPC) |
| F-06 | P1 | `npm start` crashed: server bundle read `import.meta.env` (undefined in CJS). | FIXED (esbuild define) |
| F-01 | P1 | Client called root-relative `/api/...`; unusable on GitHub Pages. | FIXED in code (`VITE_API_BASE_URL`, `ALLOWED_ORIGINS`). **Needs a deployed Express backend — owner action.** |
| F-02 | P1 | PWA scope/start_url/icons absolute `/`. | FIXED |
| F-03 | P1 | Pages deploy silently published a seed-data demo build when secrets were missing. | FIXED: fails closed unless repo variable `ALLOW_DEMO_BUILD=true` (simulated: secrets→real build; missing→fail; missing+allow→demo) |
| F-04 | P1 | Stripe webhook accepted unsigned events. | FIXED (fail closed) |
| F-05 | P2 | Stripe checkout/portal: membership check against demo store; price/redirect/customer unvalidated. | MITIGATED: checkout & portal are now **hard-disabled (503)** regardless of flags; webhook needs `ENABLE_STRIPE=true` AND a secret. Must be redesigned before Stripe is enabled. |
| F-07 | P2 | Default MoMo numbers/account name baked into Pages build. | ACCEPTED (public payment destination; override with `VITE_MOMO_*`) |
| F-11 | P1 | No `verification_officer` role in DB; only `platform_admin` can review. | OPEN — business decision |
| F-14 | P1 | Org `admin` could promote themselves to `owner` then suspend/delete the real owner; same via invitations (`org_role='owner'/'admin'`). Reproduced (admin ended up sole owner). | FIXED 20261012160000: only an active owner can grant/modify/remove owner; admins keep full administration of non-owners; invitations for owner need an owner, for admin need an admin/owner |
| **F-16** | **P0/High** | Suspended accounts were not restricted by the database (RLS + RPCs ignored `account_status`; posting/messaging/applications/deal-room restrictions were client-side only). Recorded as a "CRITICAL FINDING" in the RLS matrix; reproduced. | FIXED 20261012150000 (restrictive RLS policy on every RLS table, per-action INSERT policies, guard injected into 21 client-callable RPCs, coverage tests) + app signs suspended users out |
| **F-17** | **P1** | Candidate profiles: `get_public_candidate_profile`/`search_candidate_profiles` were callable by `anon`, and `private`/`registered_only`/`verified_employers_only` visibility and `permission_required` CV permission were not enforced — the DEFAULT (`private`) profile was fully readable, incl. CV text/file. Reproduced. | FIXED 20261012170000 (anon revoked, fail-closed visibility, CV gating). **Behaviour change:** default-`private` profiles are no longer returned to employers until the candidate applies or changes the setting |
| F-18 | P2 (Medium) | `notifications` INSERT policy is `WITH CHECK (true)`: any signed-in user can create a notification for any other user (spoofed/phishing notifications). The app creates notifications client-side, so a fix needs a redesign (definer RPC/triggers). | OPEN |
| F-19 | P2 (Medium) | A suspended user's JWT remains valid until expiry; the DB now denies data access, but the auth user should also be banned (`auth.users.banned_until` / revoke sessions) when `full_suspension` is applied. | OPEN (operational; needs Supabase admin API) |
| F-20 | P3 (Low) | Anon-executable SECURITY DEFINER helpers act as boolean oracles for known ids (`is_platform_admin`, `candidate_has_applied_to_org`, `is_user_blocked`, …); they must stay executable because RLS policies call them. | OPEN (accepted) |
| F-21 | P3 (Low) | `organizations` INSERT policy is `WITH CHECK (true)` (users can create orgs without the RPC; verification fields are guarded). Org name impersonation relies on the unverified badge. | OPEN (accepted) |
| F-15 | P3 | `users.email` is not synced from `auth.users` on email change, so invitation matching can drift. | OPEN (functional, not a vulnerability) |

## Role review (Task 1)
Only `platform_admin` (in `primary_role` or `system_role`) carries database authority (`is_platform_admin`, `get_public_candidate_profile`). Every other role value (`organization_admin`, `recruiter`, `employer`, `investor_buyer`, …) is advisory UI data: org management, billing, verification and moderation authority come from `organization_memberships.org_role`/`permissions`, whose writes require `is_org_admin()` (tested: member cannot self-promote; outsider cannot insert themselves; membership cannot be moved to another org). `verification_officer` is blocked from self-assignment although no SQL honours it yet. The server derives no roles from user-editable `user_metadata`.

## Mobile-money payments — no code defects found
Server-authoritative pricing, no direct writes to payments/subscriptions, admin-only approval, no double approval, one open payment per vacancy/listing/org subscription, unique live provider transaction id, reference hardening, expiry, org isolation, publication gated on approval (124 assertions). Approval is a manual admin judgement against the MoMo statement; there is no "amount received" field, so reconcile statements periodically.

## Migrations
`20261012100000`…`140000` follow the last existing migration (`20261011100000`), are unique and 14-digit. They are dated one day after the audit date; harmless for ordering, but any migration created later with an earlier timestamp would sort before them (Supabase CLI then needs `--include-all`). Not renamed, because it is unknown whether any were already applied somewhere. If NONE has been applied to a real project, renaming to a later-than-now timestamp is safe. Later migrations only `CREATE OR REPLACE` earlier ones (130000 supersedes the function in 100000; 140000 supersedes the RPC in 120000) so the sequence is correct whether or not earlier files were already applied.

## Test failures investigated
The 2 historic `organizations.test.ts` failures were **environment-dependent test isolation**, not a code defect: with `VITE_SUPABASE_URL` set, `authService.login()` uses real Supabase Auth ("fetch failed") instead of the in-memory demo store. Fixed by `test.env` in `vite.config.ts`; CI no longer passes Supabase secrets to the unit-test step.

## Account-status model (F-16)
active / pending_verification: normal. suspended / deactivated: no table or RPC access except reading their own `users` row and their own restriction rows (and signing out); there is no appeal write path in the schema (`appeal_notes` has no writer) so none is preserved. `posting_disabled`, `applications_disabled`, `messaging_disabled`, `deal_room_disabled` deny the matching INSERT (`deal_room_disabled` currently covers new access requests only; reads of already-approved deal rooms are not blocked — Medium, open). Platform administrators keep their administrative RPCs; a suspended administrator is denied. The test `[coverage]` assertions fail if a new RLS table lacks the policy or a new client-callable RPC lacks the guard.

## Migrations: inspect and apply to a STAGING project
```
supabase link --project-ref <STAGING_REF>                    # never the production ref
supabase migration list                                      # local vs remote versions; confirm 20261012100000..170000 are NOT yet applied remotely
supabase db push --dry-run                                   # lists exactly what would run
supabase db push                                             # applies the pending ones, in order, once
supabase migration list                                      # all 42 on both sides
# then, against the staging database URL:
for f in supabase/tests/*.sql; do psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -t -A -f "$f" | grep -E '^(not ok|ok) ' | grep -c '^not ok'; done
```
All pgTAP files run inside `BEGIN … ROLLBACK`. If a migration was already applied to a real project, do NOT edit or rename it: all follow-ups are additive `CREATE OR REPLACE` migrations (later files supersede earlier function bodies: 130000 supersedes the guard in 100000, 140000 the RPC in 120000, 150000 re-creates guarded RPC bodies, 170000 the candidate function); re-running an OLD file after a newer one would revert that function, which the CLI never does.

## REQUIRED owner actions before launch
1. Review/apply migrations through CI; confirm the CI Supabase-CLI job passes the three pgTAP files.
2. **Review existing accounts** — F-09/F-12/F-13 may already have been exploited:
   `select id, email, primary_role, system_role, created_at from public.users where primary_role in ('platform_admin','verification_officer') or system_role <> 'user' order by created_at;`
   Also: organizations `verified` without a completed review, recent `payments`/`organization_subscriptions` approvals, and `organization_memberships` with `admin`/`owner` roles you do not recognise (invitation takeover leaves a normal membership row).
3. Deploy the Express backend (needs `node_modules`; `npm ci --omit=dev` + `node dist/server.cjs`). Set `ALLOWED_ORIGINS=https://zeahn-tech.github.io` (exact match, no trailing slash), `GEMINI_API_KEY`, `VITE_SUPABASE_URL`/`SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY`; do NOT set `VITE_ENABLE_DEMO_MODE` on it. Set repo variable `VITE_API_BASE_URL=https://<backend>/api`.
4. Confirm `SUPABASE_PAGES_URL` / `SUPABASE_PAGES_ANON_KEY` repo secrets exist and Supabase Auth redirect URLs include `https://zeahn-tech.github.io/LibRise/`.
5. Org contact email/phone are now private (members/admins only). To show a public contact email, re-grant that one column in a new migration and add it to `ORG_PUBLIC_COLUMNS` (a unit test keeps them in sync).
6. Decide F-11 (verification officer role). Review pending owner/admin invitations created before 20261012160000: `select * from public.organization_invitations where status='pending' and org_role in ('owner','admin');` and revoke any you do not recognise.
7. Ban the auth user and revoke sessions whenever you apply `full_suspension` (F-19), and tell product that default-`private` candidate profiles are now hidden from employers (F-17).
