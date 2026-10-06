# Who sees what (roles) and what each plan unlocks

All UI visibility goes through **one policy**: `src/core/auth/featureAccess.ts` (built on `permissionEngine.ts`).
The Navbar, mobile bottom nav, sidebar, route guard in `App.tsx`, and AI Studio all call it, so they cannot drift apart.
It controls what is *shown*; real enforcement stays server-side (Supabase RLS + the SECURITY DEFINER payment functions).

## Roles

| Feature | Guest | Job seeker / freelancer | Employer owner/admin | Recruiter / hiring mgr | Org member (no posting role) | Business seller | Buyer / investor | Verification / moderation officer | Platform admin |
|---|---|---|---|---|---|---|---|---|---|
| Browse opportunities, Business M&A | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Post opportunity (button, FAB, modal) | - | - | yes | yes | - | - | - | - | yes |
| Recruiter Studio (jobs, pipeline, analytics) | - | - | yes | yes | - | - | - | - | yes |
| Subscriptions / billing | - | - | yes | - | - | - | - | - | yes |
| Candidate Portal (applications, CV, saved) | - | yes | - | - | - | - | - | - | yes |
| Candidate AI tools (job recommendations, CV parser) | - | yes | - | - | - | - | - | - | yes |
| Employer AI tools (candidate match, job drafter) | - | - | yes* | yes* | - | - | - | - | yes |
| List business for sale | - | - | - | - | - | yes | - | - | yes |
| Messages, AI Studio overview, Verification Hub | - | yes | yes | yes | yes | yes | yes | yes | yes |
| Trust & Safety center, AI audit trail | - | - | - | - | - | - | - | yes | yes |

\* also requires a plan with AI (Pro). Typing a restricted URL (e.g. `/recruiter`) shows an "access restricted" page.
Someone who picked both a candidate and an employer capability at onboarding sees both sets.

## Plans (resolved by `tier`, see `getPlanForSubscription`)

| Benefit | Free | Starter | Professional | Where it is enforced |
|---|---|---|---|---|
| Active vacancies | 1 | 5 | unlimited | DB `org_has_publish_quota()` + `opportunityService` |
| Candidate profiles viewable | first 10 | unlimited | unlimited | Recruiter pipeline list |
| Candidate contact details | hidden | yes | yes | Candidate profile drawer |
| AI candidate matching / job drafter | locked | locked | yes | AI Studio, AI copilot modal |
| Advanced analytics | locked | locked | yes | Recruiter -> Analytics |
| Priority support | - | standard email | priority | Subscriptions page |

Locked plan features show an upgrade prompt (owners/admins get a "View plans" button; others are told to ask the owner),
because the buyer needs to know the upgrade exists. Role-restricted features are removed entirely.
Paid plans lapse to Free limits after `current_period_end`.
