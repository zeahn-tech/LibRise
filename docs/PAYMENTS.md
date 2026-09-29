# Vacancy Payments — Manual Mobile Money (interim system)

## What this is, and what it is not

Recruiters pay a one-time fee to publish a vacancy once their plan's free publishing quota is used up.
Payment is a **real person-to-person mobile money transfer (MTN MoMo or Orange Money) to the business's own
number**, followed by the recruiter submitting the transaction ID they received. **A platform admin then checks that
transaction against the real MoMo records and approves or rejects it.** Only approval publishes the vacancy.

- **Not automatic, not instant.** There is no MTN/Orange API or webhook involved. Human review is the stand-in for one.
  The UI says so and makes no turnaround-time promise (none has been agreed).
- **Not a replacement for a real integration.** Direct MTN MoMo / Orange Money API access needs merchant KYC that only the
  business owner can pursue, and Orange's own developer docs disagree on Liberia coverage. This system is the honest bridge
  while that happens. See "Migrating to a real provider" below.
- **Never asks for a mobile money PIN**, and the UI tells recruiters never to share it.

## Lifecycle

```
recruiter clicks Publish
        │
        ├─ org has free quota left ───────────────► published (unchanged existing behaviour)
        │
        └─ quota exhausted ─► vacancy saved as `payment_required`
                                   │  recruiter picks package + network (MTN / Orange)
                                   ▼
                        payment `created`  (amount/currency set BY THE DATABASE from payment_plans;
                                   │        48h window; unique reference code OHL-XXXX-XXXX)
                                   │  recruiter sends money in their own MoMo app, submits transaction ID
                                   ▼
                        payment `payment_pending`   ── waits for a human, never auto-expires
                                   │
                    platform admin verifies against real MoMo records
                       ┌───────────┴────────────┐
                    approve                   reject (reason required)
                       ▼                        ▼
        payment `payment_success`      payment `payment_failed`
        vacancy `published`            vacancy `payment_failed`
        (one atomic DB call)           recruiter can start a new payment
```

An unsubmitted payment that passes 48h becomes `payment_expired` and the vacancy returns to `payment_required`.

## What enforces what (all in `supabase/migrations/*_manual_mobile_money_payments.sql`)

The frontend is never trusted. Every rule below is enforced in Postgres, so it holds even if someone calls the Supabase API
directly with their own login.

| Requirement | Enforcement |
|---|---|
| Amount can't be tampered with | `payments_enforce_server_pricing` trigger overwrites `amount_minor`/`currency` from `payment_plans` on insert and resets all review-only fields |
| Can't mark own payment successful | **No UPDATE policy exists on `payments`.** Changes go only through two `SECURITY DEFINER` RPCs |
| Only admins publish paid vacancies | `admin_review_payment()` checks `is_platform_admin()`; payment + vacancy + audit event commit atomically |
| Can't publish without paying | `enforce_publish_payment_gate` trigger on `opportunities` (see limitation 2) |
| Can't pay for another org's vacancy | pricing trigger checks vacancy org = paying org |
| "Pay Now" ×5 → one payment | partial unique index: one open payment per vacancy; service returns the existing one |
| One real transaction can't pay for two vacancies | unique index on `(provider, transaction_id)` for live payments; IDs normalised to upper case |
| Audit trail | `payment_events`: written only by trigger/RPCs (no INSERT policy for anyone), one row per status change |
| Tenant isolation | RLS: orgs see only their own payments; `payments.manage` (owners/admins/`all` pass) required |

Money is stored as **integer minor units** (`amount_minor`); the UI formats with integer math only.

## Setup checklist

1. Apply the migration (`supabase db push`). **It has not yet been run against a real database — see limitations.**
2. Set real business numbers (public to recruiters, so they are `VITE_`-prefixed and safe to expose):
   `VITE_MOMO_MTN_NUMBER`, `VITE_MOMO_ORANGE_NUMBER`, `VITE_MOMO_ACCOUNT_NAME`. **Left empty, the checkout refuses to
   show payment instructions** rather than showing a blank or fake number. There are deliberately no placeholder numbers.
3. Make sure at least one real user has `system_role = 'platform_admin'` — nobody else can approve payments.
4. Edit prices in the `payment_plans` table (never in code). Seed rows are examples ($5 / $10 / $20).
5. Run `supabase/tests/payments_security_tests.sql` (CI runs it in the `rls-security-tests` job).

## Admin procedure (Admin Center → Revenue Payments → "Payments awaiting review")

For each item, open the business MoMo app/statement and confirm **all** of: amount matches, the transaction ID exists and is
unused, it came from the stated sender number, and it landed on the right network account. Approve only if you personally
confirmed it. If you can't, **reject with a reason** — don't guess. The reason is shown to the recruiter.

## Known limitations (read before launch)

1. **Now verified against a real database, via CI.** The migration and `payments_security_tests.sql` were originally
   written with no Postgres/Docker available and were untested on first push; three real bugs surfaced and were fixed
   once CI actually ran them (a bash `errexit` bug that silently skipped the payments test file entirely, a missing
   pgTAP `no_plan()` declaration, and an unschema-qualified `uuid_generate_v4()` call). As of commit `2c3fc32`,
   `rls-security-tests` passes in CI — both the original 112-assertion suite and the new payments suite, running
   against a fresh `supabase start` Postgres instance on every push. See the CI run history for the current numbers.
2. **The publish gate's free-quota branch can be forged today.** Quota is derived from `organization_subscriptions`, whose
   existing RLS lets an org *admin* write their own subscription row (a documented demo/mock path — real Stripe webhook
   fulfilment does not exist yet). An org admin could set themselves to `pro` and skip payment. The gate closes the
   *direct-publish* bypass; it does not close this separate, pre-existing hole. **Fix: lock subscription writes to
   platform admins/service role.** That would also disable the current mock-upgrade demo, so it needs your decision.
3. **Tier limits are duplicated in SQL** (`org_has_publish_quota`: free 1 / basic 5 / pro unlimited) because the DB can't
   read `src/data/subscriptionPlans.ts`. Change both together.
4. **A pre-existing bug was fixed along the way:** every real org was auto-provisioned the Pro plan (any id starting with
   `org-` was treated as a seed org), so no payment gate could ever have fired. Real orgs now start on the free plan.
   Consequence: newly created orgs are limited to **1 free published vacancy** until they pay or subscribe.
   **Orgs that already looked up their subscription before this fix keep the `pro` row that was auto-created for them**
   (unlimited, no payment required) — check `organization_subscriptions` and correct rows you don't intend to grandfather.
5. Not built (from the original spec): receipts, recruiter/admin payment notifications, reconciliation reports and revenue
   statistics from real payments, refunds/cancellation, rate limiting on submissions, an admin filter/search UI,
   a scheduled job to expire stale payments (expiry currently happens lazily when the recruiter next opens checkout).
   The "Sample billing ledger" in the admin tab is **hard-coded demo data**, labelled as such — do not read it as revenue.
6. Manual review does not scale and depends on an admin being available. It is a bridge, not a destination.

## Migrating to a real provider (MTN MoMo API, Orange Money, or an aggregator)

The schema and types are provider-agnostic: `payments.payment_provider` is free text (`manual_momo_*` today). A real
provider needs (a) a new adapter for `initiatePayment` that calls the provider's collection API, (b) a **server-side**
webhook route in `server.ts` that verifies the signature and then calls a new privileged RPC to mark success — never the
client, and (c) a new value in `PaymentProviderId`. The state machine, pricing, audit table, publish gate and admin UI
carry over unchanged; manual review can remain as a fallback/reconciliation path.
Provider facts researched so far (MTN Liberia available via `momodeveloper.mtn.com`; Orange developer-API coverage of
Liberia **unresolved / needs direct confirmation**; aggregators such as XDAfrica/MoneyMatrix/pawaPay unverified for
Liberia) are in the project conversation history, not repeated here as verified fact.
