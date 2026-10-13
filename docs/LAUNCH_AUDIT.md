# Launch audit — findings register (updated after patch review)

Baseline: `main` @ c6375d2. Payments: manual mobile money only; Stripe is intentionally OFF (future work).

## Verification evidence (disposable local Postgres 16 + Supabase stand-ins; see `supabase/tests/local/README.md`)
- All 50 migrations applied with the **Supabase CLI** (`supabase db push --db-url …`); second push "up to date"; no duplicate versions; every 20261012* migration re-runs without error; documented rollbacks execute (transaction-tested).
- **Data preservation:** legacy rows seeded on the pre-fix schema, then all 16 new migrations applied: every row in all 26 tables byte-identical; function grants changed only for the 13 intentionally changed functions; only 2 policies replaced on purpose; no trigger removed.
- pgTAP (7 files, 456 assertions): RLS matrix 115, payments 124, privileged-column guards 40, account status 80, ownership/invitations 42, candidate privacy 42, notifications 13 — all pass.
- Real **PostgREST** HTTP checks (`http_authz_check.py`): 46/46.
- `npm run lint`, `build`, three bundle/secret scans: pass. `npm test -- --run`: 311/311 (with and without `VITE_SUPABASE_*`).
- Reproduced on the pre-fix schema and blocked afterwards: F-09, F-12, F-13, F-14, F-16, F-17, F-17b (three concerns), F-18, F-22, F-23, F-24.
- NOT verified here: a real Supabase project (GoTrue, Storage, Realtime; stand-in `auth` schema/roles used — CI starts a real local Supabase and runs all seven pgTAP files), ban/session behaviour of the real Auth service, Realtime event delivery, Storage buckets, server→Supabase JWT validation with real tokens, the live site, mobile/device behaviour, whether any migration was already applied to a real project.

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
| F-11 | P2 (Medium) | `verification_officer` exists in the TypeScript types and `VerificationHub` shows decision controls to it, but the database only honours `platform_admin` (`decide_verification_audit`, `review_verification_request`), and no operator process assigns the role. **Platform-admin-only verification is the safe default and is currently what is enforced; it is not documented as intentional.** An officer would see buttons that fail. | OPEN — product decision; not a vulnerability; not a launch blocker (only admins can verify) |
| F-14 | P1 | Org `admin` could promote themselves to `owner` then suspend/delete the real owner; same via invitations (`org_role='owner'/'admin'`). Reproduced (admin ended up sole owner). | FIXED 20261012160000: only an active owner can grant/modify/remove owner; admins keep full administration of non-owners; invitations for owner need an owner, for admin need an admin/owner |
| **F-16** | **P0/High** | Suspended accounts were not restricted by the database (RLS + RPCs ignored `account_status`; posting/messaging/applications/deal-room restrictions were client-side only). Recorded as a "CRITICAL FINDING" in the RLS matrix; reproduced. | FIXED 20261012150000 (restrictive RLS policy on every RLS table, per-action INSERT policies, guard injected into 21 client-callable RPCs, coverage tests) + app signs suspended users out |
| **F-17** | **P1** | Candidate profiles: `get_public_candidate_profile`/`search_candidate_profiles` were callable by `anon`, and `private`/`registered_only`/`verified_employers_only` visibility and `permission_required` CV permission were not enforced — the DEFAULT (`private`) profile was fully readable, incl. CV text/file. Reproduced. | FIXED 20261012170000 (anon revoked, fail-closed visibility, CV gating). **Behaviour change:** default-`private` profiles are no longer returned to employers until the candidate applies or changes the setting |
| F-18 | P2 | Any signed-in user could create a notification for any user (forged payment/verification notices, phishing links). | FIXED 20261012210000: recipient must be self, a related user (same org, conversation, application, business inquiry/request) or an admin; action_url must be a relative path. Residual: content inside a legitimate relationship is free text (no sender column) |
| F-19 | P2 | A suspended user's Auth login/refresh kept working. | FIXED in SQL 20261012220000 (full suspension bans the auth user, deletes sessions/refresh tokens; lifting clears the ban; failures degrade to a warning). **Real GoTrue behaviour UNVERIFIED** — validate on staging. An already-issued access JWT stays valid until expiry but gets no data (RLS, tested) |
| F-20 | P3 | Anon-executable helper functions were boolean oracles. | PARTLY FIXED 20261012240000: 11 helpers no longer executable by anon (PUBLIC revoked; verified every anon-readable table and public RPC still works). A signed-in user can still call those helpers with arbitrary ids; closing that needs a self-only redesign per helper (as done for the account-status helpers). OPEN, Low, not a blocker |
| F-21 | P3 | Organizations could be created by a direct INSERT. | FIXED 20261012230000 (INSERT policy removed; RPC only). Not present anywhere: a per-user organization cap and name-impersonation rules — product decisions. OPEN (business rules), Low |
| **F-22** | **P2** | Enforcement status of ANY account was queryable (`is_account_suspended(uid)` / `has_active_restriction(uid,type)` executable by every signed-in user). | FIXED 20261012190000: policies use self-only wrappers; parameterised helpers revoked from clients |
| **F-23** | **P1** | `accept_organization_invitation()` honoured stored owner/admin invitations created by anyone (incl. later-demoted/removed inviters), reactivated suspended members, and demoted owners. Reproduced (admin-issued OWNER invitation made the attacker owner). | FIXED 20261012200000: inviter authority re-checked at accept time; verified email required; suspended memberships not reactivated; existing roles only upgraded |
| **F-24** | **P2** | Approved deal-room access survived suspension and `deal_room_disabled`; a suspended owner kept the owner view of a listing. Reproduced. | FIXED 20261012250000 |
| **F-17b** | **P1** | Candidate privacy defaults: missing `profileVisibility` defaulted to public; unknown `contactVisibility` showed email/phone; anonymous profiles leaked identity through `cv_raw_text` / structured CV; `all_employers` CV was open to any signed-in user. Reproduced. | FIXED 20261012180000 (missing → `private`; unknown → hidden; anonymous CV artefacts withheld; `all_employers` needs an org membership). **Behaviour change** — count affected rows first |
| F-15 | P3 | `users.email` was not synced from `auth.users` on a confirmed email change, so invitation matching followed a stale address. | FIXED 20261012200000 (mirror trigger; accept requires a verified email equal to the invitee address) |

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

## Supabase Storage and Realtime — what the database policies do NOT protect
- **Storage:** the application does not use Supabase Storage (CVs are stored as data URLs in `candidate_profiles`) and no migration creates a bucket or a `storage.objects` policy. Any bucket that exists was created in the dashboard and is **not covered by these tests**. On staging: confirm there are no buckets, or that every bucket is private with explicit `storage.objects` policies; storage RLS does not consult `account_status` — add a policy using `public.current_account_suspended()` if buckets are ever used.
- **Realtime:** the only publication table is `notifications`; the app subscribes with `postgres_changes` filtered by recipient (no broadcast/presence channels). Realtime evaluates RLS with the subscriber's JWT, so the recipient-only SELECT policy and the suspended-account restrictive policy apply to events; an already-open socket can keep receiving events until its token expires/re-authenticates. **UNVERIFIED locally** (no Realtime server): test on staging by suspending a subscribed user and publishing a notification.
- Auth ban/session revocation (F-19) is the control that closes both for suspended users once the Auth service honours `banned_until`.

## Table / function exposure review (Task 4)
No public view or materialised view exists; every one of the 26 public tables has RLS enabled; `anon` holds only SELECT (25 tables) and `authenticated` SELECT/INSERT/UPDATE/DELETE — no TRUNCATE/REFERENCES/TRIGGER grants. A pgTAP coverage test fails if an RLS table lacks the restrictive suspended-account policy, if a client-callable plpgsql SECURITY DEFINER RPC that uses `auth.uid()` lacks the guard, if a parameterised enforcement helper becomes client-executable, or if a new function becomes executable by `anon` without being allow-listed.

## Pending owner/admin invitations: review and safe clean-up (do NOT automate)
Acceptance now rejects invitations whose inviter lacks authority, so stale ones are harmless, but review them:
```
select i.id, i.organization_id, i.invitee_email, i.org_role, i.created_at, i.expires_at,
       m.org_role as inviter_current_role, m.status as inviter_status
from public.organization_invitations i
left join public.organization_memberships m
  on m.organization_id = i.organization_id and m.user_id = i.inviter_user_id
where i.status = 'pending' and i.org_role in ('owner','admin')
  and (m.org_role is null or m.status <> 'active'
       or (i.org_role = 'owner' and m.org_role <> 'owner')
       or (i.org_role = 'admin' and m.org_role not in ('owner','admin')))
order by i.created_at;
```
Each row is an invitation that can no longer be accepted. After a human has confirmed with the organization owner, revoke one at a time, inside a transaction you inspect before COMMIT: `update public.organization_invitations set status = 'revoked' where id = '<id>' and status = 'pending';` (check the allowed status values first). Also review memberships created through invitations before this release: `select * from public.organization_memberships where org_role in ('owner','admin') order by created_at desc;`.

## REQUIRED owner actions before launch
1. Review/apply migrations through CI; confirm the CI Supabase-CLI job passes the three pgTAP files.
2. **Review existing accounts** — F-09/F-12/F-13 may already have been exploited:
   `select id, email, primary_role, system_role, created_at from public.users where primary_role in ('platform_admin','verification_officer') or system_role <> 'user' order by created_at;`
   Also: organizations `verified` without a completed review, recent `payments`/`organization_subscriptions` approvals, and `organization_memberships` with `admin`/`owner` roles you do not recognise (invitation takeover leaves a normal membership row).
3. Deploy the Express backend (needs `node_modules`; `npm ci --omit=dev` + `node dist/server.cjs`). Set `ALLOWED_ORIGINS=https://zeahn-tech.github.io` (exact match, no trailing slash), `GEMINI_API_KEY`, `VITE_SUPABASE_URL`/`SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`/`SUPABASE_ANON_KEY`; do NOT set `VITE_ENABLE_DEMO_MODE` on it. Set repo variable `VITE_API_BASE_URL=https://<backend>/api`.
4. Confirm `SUPABASE_PAGES_URL` / `SUPABASE_PAGES_ANON_KEY` repo secrets exist and Supabase Auth redirect URLs include `https://zeahn-tech.github.io/LibRise/`.
5. Org contact email/phone are now private (members/admins only). To show a public contact email, re-grant that one column in a new migration and add it to `ORG_PUBLIC_COLUMNS` (a unit test keeps them in sync).
6. Decide F-11 (verification officer role) and the F-17b default (candidates now hidden until they apply / opt in). Review pending owner/admin invitations created before 20261012160000: `select * from public.organization_invitations where status='pending' and org_role in ('owner','admin');` and revoke any you do not recognise.
7. Ban the auth user and revoke sessions whenever you apply `full_suspension` (F-19), and tell product that default-`private` candidate profiles are now hidden from employers (F-17).

## Required staging validation (cannot be done locally)
1. `supabase migration list` → apply with `db push --dry-run` then `db push` on STAGING only; run the seven pgTAP files (they roll back).
2. Real Auth: sign up → confirm email → log in → refresh; password recovery link under `/LibRise/`; invite → accept (verified and unverified email); change email and re-check invitation matching (F-15).
3. Suspend a logged-in test user with `apply_account_restriction('full_suspension')`: confirm the next refresh/login is refused (ban), data calls return nothing, a Realtime subscription stops delivering, and `lift_account_restriction` restores everything. If `set_auth_ban` logged a WARNING, apply the ban through the Auth admin API instead (F-19).
4. Candidate flows: a new candidate (default `private`) is hidden from employer search until they apply; `public` + `all_employers` shows the CV only to org members.
5. Notifications: application, message, verification and payment flows still notify the right people (F-18); a forged notification for a stranger is refused.
6. Deal room: approved buyer sees confidential figures; after `deal_room_disabled` or suspension they do not.
7. Storage: list buckets (expected none). Realtime: see above.
8. Mobile-money payment submit/approve, organization registration, opportunity publish/apply, AI features through the deployed backend, GitHub Pages routing/PWA install.
