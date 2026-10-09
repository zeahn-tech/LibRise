# Vacancy & Subscription Payments — Manual Mobile Money (interim system)

## What this is, and what it is not

Two payment targets share one system: recruiters pay a one-time fee to publish a vacancy once their plan's
free publishing quota is used up, and organizations pay a recurring fee to upgrade their subscription tier
(Basic/Pro). Both work identically: payment is a **real person-to-person mobile money transfer (MTN MoMo or
Orange Money) to the business's own number**, followed by the payer submitting the transaction ID they
received. **A platform admin then checks that transaction against the real MoMo records and approves or
rejects it.** Only approval publishes the vacancy, or activates the subscription tier — see
`payment_plans.plan_type` (`vacancy` | `subscription`) and `admin_review_payment()`'s branching.

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
| Fake / junk transaction IDs | `submit_payment_reference()` runs `normalize_momo_transaction_id()` + `normalize_sender_phone()` server-side (migration `20261006100000_*`): 8-25 chars of letters/digits/`.`/`-`; rejects repeated or sequential characters, our own `OHL-` reference, and the payer's phone number. **Sender phone is mandatory.** The UI mirrors the rules in `src/services/paymentValidation.ts` for instant feedback only |
| Guessing IDs until one sticks | 3 rejected payments in 24h pauses a user's submissions; max 3 payments pending at once; a real transaction ID can still back only one live payment (unique index) |
| Paid plan outliving its period | `org_has_publish_quota()` and `subscriptionService.getEntitlements()` treat a paid tier past `current_period_end` as free. Renewing the **same tier** early extends the current period; switching tier starts a fresh period from approval |
| Audit trail | `payment_events`: written only by trigger/RPCs (no INSERT policy for anyone), one row per status change |
| Tenant isolation | RLS: orgs see only their own payments; `payments.manage` (owners/admins/`all` pass) required |

Money is stored as **integer minor units** (`amount_minor`); the UI formats with integer math only.

## Setup checklist

1. Apply the migration (`supabase db push`). **It has not yet been run against a real database — see limitations.**
2. Set real business numbers (public to recruiters, so they are `VITE_`-prefixed and safe to expose):
   `VITE_MOMO_MTN_NUMBER`, `VITE_MOMO_ORANGE_NUMBER`, `VITE_MOMO_ACCOUNT_NAME`. **Left empty, the checkout refuses to
   show payment instructions** rather than showing a blank or fake number. There are deliberately no placeholder numbers.
3. Make sure at least one real user has `system_role = 'platform_admin'` — nobody else can approve payments.
4. Edit prices in the `payment_plans` table (never in code). Current prices (migration `20261008100000_*`): pay-as-you-go Basic $3 / Featured $5 / Premium (boosted) $10; Starter $10/mo or $100/yr; Pro $25/mo or $250/yr. Annual plans are 365 days and monthly 30, guaranteed by a CHECK constraint, and the amount is always taken from this table server-side.
5. If you installed via `supabase/manual/payments_setup.sql`, re-run it to pick up Part 5 (reference hardening + subscription
   expiry); with `supabase db push` the migration `20261006100000_*` applies automatically.
6. Run `supabase/tests/payments_security_tests.sql` (CI runs it in the `rls-security-tests` job).

## What the system can and cannot prove about a transaction ID

The transaction ID is issued by MTN / Orange, **not by this system**, so the app can never confirm that one is real, and it
cannot be restricted to an ID "generated by the system" (the system's own `OHL-XXXX-XXXX` reference is a different thing: the
payer should put it in the MoMo note so the admin can match the payment quickly). Only a human checking the business MoMo
statement can confirm the money arrived. The checks above make fakes cost effort and make them easy to spot; they do not
replace that review. The only fully automatic fix is a real provider integration (see the last section).
The ID shape rule (8-25 chars) is deliberately conservative: once you have real sample IDs from both networks, tighten the
regex in `normalize_momo_transaction_id()` (and `paymentValidation.ts`) per network.

## Admin procedure (Admin Center → Revenue Payments → "Payments awaiting review")

For each item, open the business MoMo app/statement and confirm **all** of: amount matches, the transaction ID exists and is
unused, it came from the stated sender number, and it landed on the right network account. Approve only if you personally
confirmed it. The Approve button stays disabled until the three on-screen confirmations (amount, transaction ID, sender number) are ticked. If you can't, **reject with a reason** — don't guess. The reason is shown to the recruiter.

## Known limitations (read before launch)

1. **Now verified against a real database, via CI.** The migration and `payments_security_tests.sql` were originally
   written with no Postgres/Docker available and were untested on first push; three real bugs surfaced and were fixed
   once CI actually ran them (a bash `errexit` bug that silently skipped the payments test file entirely, a missing
   pgTAP `no_plan()` declaration, and an unschema-qualified `uuid_generate_v4()` call). As of commit `2c3fc32`,
   `rls-security-tests` passes in CI — both the original 112-assertion suite and the new payments suite, running
   against a fresh `supabase start` Postgres instance on every push. See the CI run history for the current numbers.
2. **Fixed — subscription upgrades now go through the real payment system.** Previously "Upgrade" in
   `SubscriptionManager.tsx` called `subscriptionService.mockFulfillSubscription()`, which wrote straight to
   `organization_subscriptions` with no payment of any kind — exactly why a user reported "I click upgrade and it
   switches plans, but I never see anywhere to send money." `organization_subscriptions` is no longer writable by
   org admins at all (no INSERT/UPDATE policy exists); the only way it changes now is `admin_review_payment()`
   approving a real, manually-verified payment — the identical flow vacancy publishing already used. This also closes
   the previously-documented hole where an org admin could forge a `pro` row to skip the vacancy publish gate's quota
   check. `payment_plans` now has a `plan_type` (`vacancy` | `subscription`) column; subscription tiers/pricing are
   seeded there matching `src/data/subscriptionPlans.ts` exactly — **keep both in sync manually**, the DB can't read
   the TypeScript file. `mockFulfillSubscription()` is left in `subscriptionService.ts` only because a fully-mocked
   unit test exercises it; calling it against a real database is now rejected. Subscriptions now expire (see the table above); the Subscription page shows the end date and a Renew/Extend button
   instead of the old Stripe "Manage Billing" placeholder. There is still no self-service
   downgrade/cancellation flow — `SubscriptionManager.tsx` shows a plain message instead of pretending one exists.
3. **Tier limits live in ONE SQL function**, `tier_limits()` (jobs Free 1 / Starter 10 / Pro 50; business listings 1 / 3 / 10; featured slots 0 / 1 / 5). `org_has_publish_quota()`, `owner_listing_limit()` and the featured-slot guard all call it, and `org_effective_tier()` is the single place that turns a lapsed or missing paid plan into `free`. `src/data/subscriptionPlans.ts` only mirrors these numbers for display; `src/tests/pricing.test.ts` fails if the two drift. Free is a permanent plan (no trial, no expiry). Pay-as-you-go: approving a Featured/Premium vacancy payment also sets `is_featured` / `featured_until` / `boosted_until` (Premium); clients cannot set these columns themselves (`guard_opportunity_promotion`).
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

## Free Basic job, optional promotions, subscriptions

LibRise is free to start: **free -> promote -> subscribe.**

- **Basic - Free ($0):** the first active job on the Free plan publishes immediately, with no payment. Free is permanent
  (no trial, no expiry); a lapsed paid plan falls back to it (`org_effective_tier()`), and nothing is deleted.
- **Promotions (optional, one vacancy):** Boost $3 (Boosted badge, ranks above basic), Featured $5 (Featured badge, ranks
  above Boost), Premium $10 (Premium badge, top placement). They are the existing `vacancy` payment plans (ids unchanged;
  `plan-vacancy-basic` is the Boost plan). Ranking is applied in `opportunityService.list()` for every list and search:
  Premium > Featured > Boost > basic, newest first within a level. Only these benefits exist; nothing else is promised.
- **Subscriptions:** Starter $10/mo or $100/yr (10 active jobs), Pro $25/mo or $250/yr (50 active jobs). Starter includes 1
  featured slot and Pro 5 (used from *Recruiter workspace -> Promote your vacancies*).
- **Posting flow** (`PostOpportunityModal`): "Basic - Free" is the first option and "Post Free" publishes at once. Choosing
  a promotion publishes the Basic post immediately (if the free limit allows) and opens the existing `PaymentCheckoutFlow`
  for that promotion (MTN or Orange, transaction ID, admin approval). If the free limit is already used, the vacancy is
  saved as `payment_required` and one of the paid options is needed to take it live. The client only names a plan id; the
  amount always comes from `payment_plans`.
- **Approval** (`admin_review_payment()`): publishes a vacancy that was waiting on payment, and applies the promotion
  (`promotion_level`, `promotion_until`; Featured/Premium also `is_featured`/`featured_until`, Premium also `boosted_until`)
  for the plan's `duration_days` (Boost 30, Featured 30, Premium 45). Buying a weaker promotion never downgrades a stronger
  active one (it just adds time). **Rejecting** a promotion payment never unpublishes a live vacancy.
- **Expiry:** promotions are checked when listings are read (`promotionFields()`), so they lapse by themselves back to a
  normal listing; the vacancy is never deleted or unpublished. Clients cannot set any promotion column
  (`guard_opportunity_promotion`).
- **Admin queue** (Revenue Payments -> Awaiting review) shows the payment type (Subscription Starter/Pro, or Vacancy
  Boost/Featured/Premium), what approval will do (publish, or switch on a promotion for an already-live vacancy), the
  vacancy or organization, who requested it, amount, network, transaction ID, sender number, reference and dates.
- **Seller / Business for Sale listings:** basic presence stays free (Free plan: 1 listing; Starter 3; Pro 10, enforced by
  `tier_limits()`). There is no paid seller promotion yet. A future one would need: a promotion level/expiry on
  `business_listings` (like `opportunities.promotion_level/promotion_until`), a `business_listing` payment plan type
  and approval branch in `admin_review_payment()`, a ranking rule in `businessService`, and the same client-write guard.
- **Not built:** a separate "priority visibility" ranking for Pro beyond featured placement, per-vacancy performance
  analytics beyond the existing views/applications counts, and self-service downgrade/cancellation (contact support).

## Stale checkout prices

An organization has at most one open payment per target, and checkout resumes it. A payment still in `created` (no
transaction reference) is re-quoted: `refresh_open_payment()` moves it to the plan just picked at that plan's current
price, and a trigger on `payment_plans` re-quotes unpaid payments whenever a plan price changes. Once a reference is
submitted (`payment_pending` and later) the quoted amount is frozen so what the customer was told to send never changes.

