# Legal pages and cookie consent

Public pages (no sign-in needed): `#/legal` (index), `#/legal/privacy`, `#/legal/terms`, `#/legal/refunds`, `#/legal/cookies`.
Linked from the landing screen, the app footer, the sign-up form (required checkbox) and the cookie banner.

## Where things live

| What | File |
|---|---|
| Operator facts (company name, support email, address, response times, governing law, document version) | `src/legal/legalConfig.ts` (override with `VITE_LEGAL_ENTITY_NAME`, `VITE_LEGAL_ADDRESS`, `VITE_SUPPORT_EMAIL`) |
| Text of the four documents | `src/legal/documents.ts` |
| Everything the app stores on a device (drives the Cookie Policy table) | `STORAGE_REGISTRY` in `src/lib/consent.ts` |
| Consent logic / banner | `src/lib/consent.ts`, `src/components/legal/CookieConsent.tsx` |
| Page renderer | `src/components/legal/LegalPage.tsx` |

## Keeping them true

The documents describe real behaviour (providers, AI, payments, storage). When one of these changes, change the matching text and bump `LEGAL.documentVersion`:

- a new service provider, analytics tool or ad tool is added (the Privacy and Cookie policies must list it);
- anything new is written to localStorage/cookies/cache (add it to `STORAGE_REGISTRY`; a test fails if a raw `localStorage.setItem('literal')` appears);
- payment methods, prices handling, cancellation or refund handling change;
- account deletion / data export is built (update "Your choices and rights").

If the cookie categories change, increase `CONSENT_VERSION` so everyone is asked again.

## Decisions the operator must confirm (defaults are in `legalConfig.ts`)

- Legal entity name and support email: confirmed as **ZEahn Inc.** and **ezeahna@gmail.com** (set in `legalConfig.ts` / `constants.ts`). Add `VITE_LEGAL_ADDRESS` if you want a postal address shown.
- Response commitments (confirmed by the operator; adjusted 26 Oct 2026 to meet standard practice): privacy requests 30 days; refund requests within 14 days of payment (for our own faults the 14 days run from the problem, up to 60 days after payment; money we received but did not approve is always returned); refund decision within 7 business days; approved refunds sent within 5 business days, with the transfer cost paid by us when the refund is our responsibility.
- Annual plans are not refunded part-way and "Switch to Free now" is not refunded (both kept as the operator chose), but the fault cases always apply. Plans never renew automatically, which the documents state because it is true (manual, prepaid payments).
- Liability cap (greater of 12 months of fees or USD 100) and governing law/courts (Republic of Liberia).
- Minimum age 18.

These texts are a practical, code-accurate draft. Have a Liberian lawyer review them before relying on them.
