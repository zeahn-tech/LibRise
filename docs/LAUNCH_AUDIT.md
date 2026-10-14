# LibRise launch audit — findings register (V5)

Baseline `main` @ c6375d2. Payments: manual mobile money only; **Stripe is intentionally disabled** (checkout/portal return 503 regardless of flags; webhook needs `ENABLE_STRIPE=true` AND a signing secret).
Migrations: **52 files** (34 original + 18 `20261012*`), unique 14-digit versions, strictly ordered. Nothing here has been applied to any real project by this work.

## 1. Verification evidence (what was actually executed)
Local disposable Postgres 16 + PostgREST 12.2.3. Two auth schemas are used: a minimal stand-in, and the **real GoTrue schema** built from `supabase/auth` `migrations/` (76 files; used to verify column types and the ban/session tables).
| Check | Result |
|---|---|
| Supabase CLI `db push` of all 52 migrations to a fresh DB | applied; second push "Remote database is up to date"; 52 versions recorded |
| pgTAP, 9 files, both auth schemas | 531 assertions each: RLS matrix 115, payments 124, privileged-column guards 40, account status 82, auth ban 40, deal room 24, ownership/invitations 43, candidate privacy 49, notifications 13 — 0 failed |
| PostgREST HTTP authorization checks (`supabase/tests/local/http_authz_check.py`) | 52/52 on both schemas |
| Legacy-data preservation (rows seeded on the pre-fix schema, all new migrations applied) | the only table difference is the NEW empty `account_auth_enforcement`; every row of the 26 existing tables is byte-identical; 13 functions changed grants on purpose; 2 policies replaced on purpose; no trigger removed |
| Re-running each new migration on a migrated DB | OK, except `…220000` (cannot be replayed after `…260000`: it re-declares `set_auth_ban` as `void`). The CLI never replays applied files; never run old files by hand |
| Rollback statements of the newest migrations in a rolled-back transaction | execute without error |
| `npm run lint` / `build` / 3 secret+bundle scans / `npm test -- --run` | exit 0 / 0 / 0 / 311 of 311 (also with `VITE_SUPABASE_*` set) |

**Not executed (needs a real Supabase project):** GoTrue sign-in and token-refresh refusal for a banned user, whether the hosted `postgres` role may write `auth.*`, Realtime delivery, Storage, the Express server validating real tokens, the GitHub Actions run, the live site, mobile. The local run cannot prove these.

## 2. Findings register and classification
Class: **R** = resolved with evidence (locally) · **V** = potential, needs staging validation · **I** = intentional product behaviour · **A** = accepted residual risk · **D** = product decision open.
| ID | Sev | Finding | Class | Evidence / remaining risk |
|---|---|---|---|---|
| F-12 | P0 | Signup metadata could assign `platform_admin` | R | reproduced + blocked; `…110000` |
| F-09 | P0 | Self-UPDATE of `system_role`/`primary_role`/`account_status` | R | `…100000`, HTTP + pgTAP |
| F-13 | P0 | Self-editable `users.email` → invitation takeover | R | `…130000` |
| F-10 | P0 | Org admin self-verification / pre-verified orgs | R | `…100000` + F-21 |
| F-16 | P0/High | Suspended accounts not restricted by DB | R | `…150000`; RLS matrix finding inverted |
| F-14 | P1 | Admin → owner takeover (membership + invitations) | R | `…160000`; reproduced |
| F-23 | P1 | Stored owner/admin invitations accepted regardless of inviter authority; suspended members reactivated; owners demoted | R | `…200000`; reproduced |
| F-08 | P1 | Org tax ID/contact data readable by anyone | R | `…120000/140000`; HTTP `select=*` rejected |
| F-17 / F-17b | P1 | Candidate profiles readable by anon; defaults/unknown values/CV leaks | R | `…170000/180000`; 49 tests. **Behaviour change:** profiles without a stored `profileVisibility` are now hidden |
| **F-19b** | **High** | `set_auth_ban` ran ban + deletes in one exception block: a failed session cleanup rolled back the ban while the RPC reported success and public status said "suspended" (reproduced on the real GoTrue schema); lifting an unrelated restriction reinstated a suspended account | R (DB side) | `…260000`: ban is its own step and persists; result verified and recorded (`account_auth_enforcement`, `audit_logs`, WARNING); a trigger on `users.account_status` enforces on every pathway; admin report + retry RPC; lift only acts on `full_suspension`. Real Auth refusal: **V** |
| F-19c | Medium | Direct writes to `auth.users/sessions/refresh_tokens` from SQL are not a documented Supabase contract; the supported mechanism is the Auth Admin API (`ban_duration`, sign-out) called with the service-role key from a backend | V | Types verified against real GoTrue (`users.id` uuid, `sessions.user_id` uuid, `refresh_tokens.user_id` varchar(255) — the original comparison was type-valid). Staging must confirm the hosted `postgres` role can write; the reconciliation RPC detects failure. Recommended hardening: have the Express backend call the Admin API after suspension |
| F-24 / F-24b | Medium | Approved deal-room access survived suspension/`deal_room_disabled`; owner-with-restriction could keep approving; access oracles | R | `…250000/270000`; 24-scenario matrix; 3 gaps proven pre-fix |
| F-22 | Medium | Anyone could query another account's suspension/restriction status | R | `…190000` |
| F-18 | Medium | Notification forgery to any user | R (partly A) | `…210000`; residual: free text inside a legitimate relationship, no sender column |
| F-21 | Low | Direct organization INSERT | R | `…230000`. Org-per-user cap and name-impersonation rules do not exist: **D** |
| F-15 | Low | `users.email` not synced from auth | R | `…200000`; accept requires verified email equal to invitee |
| F-20 | Low | Helper functions as oracles | R (anon) / A (signed-in) | anon executes only 5 intentionally public functions (coverage test). Signed-in users can still call `is_platform_admin(uid)` and `is_conversation_participant(conv, uid)` (policies need them). Not a launch blocker |
| F-11 | Medium (functional) | `verification_officer` appears in UI/types, DB only honours `platform_admin` | D | Platform-admin-only verification is the **safe default currently enforced**, not documented as intentional; an officer would see buttons that fail. Not a vulnerability; decide before onboarding officers |
| F-25 | Low | Invitation tokens are generated client-side with `Math.random()` | A | mitigated by email binding + verified email + inviter re-check; fix = server-side `gen_random_bytes` default |
| F-26 | Low | `record_opportunity_view` (anon) can inflate view counters | A | pre-existing |
| F-27 | Low | An expired time-boxed `full_suspension` does not auto-lift (status stays `suspended` until an admin lifts) | I | pre-existing behaviour; fail-safe |
| F-05 | Medium (dormant) | Stripe checkout/portal flaws | I | hard-disabled; separate work item before enabling Stripe |
| F-01…04, 06, 07 | — | API base URL/CORS, PWA scope, Pages deploy fail-closed, webhook fail-closed, server bundle crash, public MoMo numbers | R / I | earlier rounds; re-verified: built manifest `start_url ./`, CORS exact-origin only, Stripe 503 |

## 3. Account-status and deal-room policy (as implemented)
* active / pending_verification: normal. suspended / deactivated: no table or RPC access except reading their own `users` row and their own restriction rows; auth user banned and sessions revoked; no appeal write path exists in the schema, so none is preserved.
* `posting_disabled`, `applications_disabled`, `messaging_disabled`: matching INSERT denied. `deal_room_disabled`: cannot request access, sign NDAs, or approve/decline requests; confidential fields withheld from a restricted or suspended buyer even if previously approved; a restricted OWNER still sees/edits their listing but cannot grant new access (existing approvals stay — **ambiguous, conservative choice**). Platform admins have no confidential read path (unchanged).
* Coverage tests fail if a new RLS table lacks the restrictive policy, a new client-callable RPC lacks the guard, a definer function lacks a pinned `search_path`, a table lacks RLS or a view appears, or a new function becomes executable by `anon`.

## 4. Inventory of security-sensitive objects
* **Tables:** 27 in `public` (26 original + `account_auth_enforcement`), all RLS-enabled, no views/materialised views. `anon`: SELECT only (25 tables). `authenticated`: SELECT/INSERT/UPDATE/DELETE; no TRUNCATE/REFERENCES/TRIGGER grants. Sensitive: `users` (guarded columns), `organizations` (5 private columns, column-level grants), `candidate_profiles` (owner-only; RPC-redacted), `account_restrictions`, `account_auth_enforcement` (admin read only), `organization_memberships`/`organization_invitations` (ownership guards), `payments`/`organization_subscriptions` (server pricing, admin approval), `business_listings`/`business_access_requests` (confidential data via RPC), `notifications` (relationship rule).
* **Functions:** 71 SECURITY DEFINER functions, all with a pinned `search_path`. Client-callable privileged RPCs carry `assert_account_active()`. Non-trigger definer functions executable by `anon`: `get_business_listing_public`, `list_business_listings_public`, `org_effective_tier`, `priority_organization_ids`, `record_opportunity_view` (intended). Trigger functions are not callable directly.
* **Storage:** the application does not use Supabase Storage (CVs are data URLs in `candidate_profiles`) and no migration creates a bucket or `storage.objects` policy. Any bucket created in the dashboard is **not covered** and storage RLS does not consult account status. **Validate on staging that no buckets exist (or all are private with explicit policies).** Not testable locally.
* **Realtime:** only `notifications` is published and the app subscribes with `postgres_changes` filtered by recipient (no broadcast/presence). Events pass through RLS with the subscriber's token, so recipient-only SELECT and the suspended-account policy apply; an already-open socket persists until its token expires/re-authenticates (the ban stops re-authentication). **Not executable locally — validate on staging.**

## 5. Pending owner/admin invitations — review and safe clean-up (never automatic)
Acceptance rejects invitations whose inviter lacks authority, so stale ones are inert, but review them. The query below is executed by a pgTAP test and flags exactly those:
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
Procedure: export the result, confirm each row with the organization's owner, then in a transaction you inspect before COMMIT set `status = 'revoked'` for one id at a time (check the allowed status values first). Also review: `select * from public.organization_memberships where org_role in ('owner','admin') order by created_at desc;`, admin-role accounts `select id,email,primary_role,system_role from public.users where primary_role in ('platform_admin','verification_officer') or system_role <> 'user';`, and candidate profiles that become hidden: `select count(*) from public.candidate_profiles where coalesce(privacy_settings->>'profileVisibility','') = '';`.

## 6. Required staging validation (cannot be done locally)
1. Link the CLI to the STAGING project only. `supabase migration list` (new versions must be absent remotely) → `supabase db push --dry-run` → `supabase db push` → `supabase migration list` (52 on both sides).
2. Run all nine pgTAP files against staging (`BEGIN … ROLLBACK`); optionally run `supabase/tests/local/run.sh` with `GOTRUE_MIGRATIONS_DIR` pointing at a clone of `supabase/auth`.
3. **Auth ban (F-19b/c):** create a test user, sign in (note the refresh token), suspend with `apply_account_restriction('full_suspension')`. Confirm: password sign-in refused; refresh with the old token refused; the old access token returns no data and writes are denied via the REST API; `select * from public.account_auth_enforcement` shows `applied` (if `failed`, the hosted role cannot write `auth.*` → apply the ban through the Auth Admin API from the backend and keep using `list_suspended_accounts_not_banned()` as the control); lift → sign-in works again; an unrelated restriction (posting_disabled) survives; a second active suspension keeps the ban when the first is lifted.
4. **Realtime:** subscribe a test user to notifications, suspend them, publish a notification: no event must arrive after the next token check. **Storage:** list buckets (expected none); if any exist, review each policy.
5. Candidates: default-`private` candidate hidden from employer search until they apply; `public` + `all_employers` CV visible only to org members; anonymous profile shows no identity through CV data.
6. Invitations: invite → accept with a verified and an unverified email; email change then re-check matching; an old admin-issued owner invitation is refused.
7. Deal room, notifications (application/message/verification/payment flows still notify the right people), organization registration, opportunity publish/apply, mobile-money submit/approve, AI features via the deployed backend, password recovery link under `/LibRise/`, PWA install.

## 7. Required owner actions before any production deployment
1. CI green on a real local Supabase (all nine pgTAP files) and the staging checks above.
2. Review existing accounts, invitations, organizations marked verified and recent payment approvals (F-09/F-12/F-13 may already have been exploited).
3. Deploy the Express backend (`ALLOWED_ORIGINS`, `GEMINI_API_KEY`, Supabase URL/anon key; never `VITE_ENABLE_DEMO_MODE`), set `VITE_API_BASE_URL`, confirm Pages secrets and Supabase redirect URLs.
4. Tell product about: hidden-by-default candidate profiles (F-17b), private organization contact details (F-08), frozen deal-room approvals for restricted owners (F-24b); decide F-11.
5. Plan the Auth Admin API call from the backend (F-19c) and the server-generated invitation tokens (F-25).
