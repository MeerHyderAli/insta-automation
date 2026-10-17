# Limitations and Verification Status

**Last updated:** 2026-10-17

This document separates what is proven locally from what depends on Meta approval, a hosted
environment, or features that are deliberately not built. If a capability is not listed as verified,
do not represent it as verified to a customer.

## 1. Verification legend

| Status | Meaning |
| --- | --- |
| **VERIFIED (docs)** | Implemented against official Meta documentation, with the exact endpoint/fields recorded in `META_API_FEASIBILITY.md`. Not the same as live-account verification. |
| **CONDITIONAL** | Possible only with prerequisites (App Review/Advanced Access, app Live, public professional account, user consent, or a specific message window). |
| **UNVERIFIED** | No authoritative documentation found, or behavior depends on account/app state that cannot be tested here. |
| **UNSUPPORTED** | Not available through the official API, or intentionally not implemented. |

## 2. What is verified locally

- Typecheck, lint, production server build and client build pass.
- 149 automated tests pass: server unit + API integration (116), database schema/RLS/store on PGlite
  (23), and React UI (10). See `REPORT.md` for the exact command output.
- The API uses the real migration files and a real Postgres engine (PGlite) for DB tests; it does not
  mock SQL behavior.
- OAuth, webhook signature verification, deduplication, keyword matching, rule enable/disable,
  retry-vs-permanent error handling, quota exhaustion and cross-tenant denial are covered by tests
  using a fake Instagram provider. The fake is never used in production.
- The React tests cover loading, empty, error/retry, success, demo labelling and automation-builder
  validation.

## 3. What requires a live environment / Meta approval

Everything below is implemented but **not validated against a real account in this sandbox**. The
sandbox has no Supabase project, public HTTPS host, Meta app credentials, or real Instagram account.

| Capability | Status | What is needed |
| --- | --- | --- |
| Instagram Login OAuth (authorize, code exchange, 60-day token, refresh) | VERIFIED (docs) / not live-tested | Meta Business app, exact redirect URL, Instagram tester account |
| Comment webhooks (`comments`) | CONDITIONAL | Advanced Access for `instagram_business_manage_comments`, app Live, public professional account, confirmed subscription |
| Public reply to a comment | CONDITIONAL | Same as above; the comment must belong to the connected account's media |
| Private reply (one message per comment, 7-day window) | CONDITIONAL | `instagram_business_manage_messages`; user must have commented; Meta's one-per-comment rule; some accounts/followers may receive it in Requests |
| Media/posts/Reels listing | VERIFIED (docs) / not live-tested | `instagram_business_basic`; public professional account |
| Webhook subscription (`/me/subscribed_apps`) | VERIFIED (docs) / not live-tested | App credentials and a valid account token |
| Deauthorize and data-deletion callbacks | VERIFIED (docs) / not live-tested | URLs registered in the Meta app |
| `live_comments` automation | UNSUPPORTED | The app stores the event but rejects automation; this was a deliberate scope decision, not a Meta guarantee |
| Follower status for an arbitrary commenter | UNSUPPORTED | Not exposed by the official API at comment time; no scraping or private endpoints are used |
| Follow check after the user messages the app | CONDITIONAL / not implemented | Requires the user to message the app (consent), `instagram_business_manage_messages`, the User Profile API, and a new inbound message flow. The MVP does not collect that consent |
| Insights/analytics from Instagram | UNSUPPORTED (app) | The dashboard analytics are computed from this app's own events; Instagram Insights is not ingested |
| AI classification/drafting | UNSUPPORTED (app) | No route or UI exposes it. `server/src/ai/provider.ts` contains a disabled-by-default provider interface, a deterministic template fallback, output validation and a per-workspace daily budget, but `AI_SUGGESTIONS_ENABLED` stays `false` |

To finish live verification, the operator must:

1. Deploy the API and client to public HTTPS origins.
2. Create/configure the Meta Business app as described in `SETUP.md`.
3. Complete App Review/Advanced Access and switch the app to Live.
4. Connect a public professional test account.
5. Install a comment on one of its posts and confirm: webhook `200`, a run in Activity, a public reply
   id, a private reply message id, and the exact text rendered.
6. Run `npm run test:live` with `LIVE_META_TESTS=1` and a long-lived token; optionally enable the
   write test with `LIVE_META_ALLOW_WRITES=1` and `IG_LIVE_COMMENT_ID` on a test account only.

## 4. Product limitations (intentional MVP scope)

| Area | Limitation |
| --- | --- |
| Billing | Plans (free/creator/studio) are seeded and quota-enforced, but there is **no payment provider or subscription checkout**. Plan changes are operational/DB-level. |
| Team invitations | Members can be added by the email of an existing user; there is no email invitation delivery flow or accept link. |
| Messaging inbox | No inbox, conversation view, follow-up automation, media messages, quick replies, buttons or human-agent handoff. Private replies are text-only and one per comment. |
| Reply windows | The 7-day private-reply window is enforced locally. Follow-ups after a user reply (24-hour window) are not implemented. |
| Live comments | Stored but not automated; `live_comments` automation returns unsupported. |
| Post selection | Media is synced and cached; album/carousel child IDs and Story mentions are not modeled. |
| Analytics | Counts come from webhook/run records; no Instagram Insights, no attribution to revenue, no export. |
| AI | Not exposed. Templates are deterministic and previewed client-side; the server re-renders and validates before sending. The AI interface/budget/validator are scaffolding only. |
| Multi-account rules | One rule targets one connected account; there is no cross-account rule template. |
| Scheduling | No scheduled posts/campaigns; automation is event-driven only. |
| Password reset | Supabase's email reset is available at the provider level, but the app does not expose a forgot-password screen. Add it before self-serve production. |
| Localization | English-only UI and copy. |
| Dark mode | The README/plan mentions light UI; no theme switcher is implemented. |

## 5. Operational limitations

- **Single API process by default.** The worker runs in-process and is safe to run on one instance.
  Multiple workers are safe thanks to `SKIP LOCKED`, but the maintenance interval (token refresh,
  retention) should not run on every replica without coordination.
- **Rate limiting is in-memory per process.** It is adequate for one instance; a multi-instance
  deployment needs a shared limiter for global limits.
- **No automated backups on Supabase Free.** The free project can pause after inactivity. Use Supabase
  Pro or an external backup schedule for anything customer-facing.
- **Webhook payload retention is 30 days** (`purgeOldData(30)`); analytics aggregate events and runs may
  outlive the raw payload. Review this against your privacy policy.
- **No dead-letter UI.** Failed jobs remain visible in `automation_jobs`/`automation_runs`; the
  dashboard shows run failures but there is no retry/dead-letter admin screen.
- **PGlite is not Supabase.** The DB tests use real Postgres semantics in-process, but hosting
  differences (extensions, pooler behavior, Auth/RLS roles) can still surface. Run
  `supabase/tests/rls.test.sql` and staging tests against the real project.
- **No load test.** Expected MVP volume is low; verify Meta's 750 private replies/hour/account and
  4,800 × impressions rate limits before high-volume use.
- **No paid AI calls, no scraping, no password collection, no browser automation.** The app only uses
  documented Meta endpoints.

## 6. Security limitations and residual risks

- Token encryption protects data at rest, but a compromised server process or key can decrypt tokens.
  Keep the key in a secret manager with restricted access and rotate with a planned reconnect.
- Supabase JWT verification depends on correct project configuration. If `SUPABASE_URL` points at the
  wrong project, tokens from the other project will be rejected; if `SUPABASE_JWT_SECRET` is used, it
  must be kept server-only.
- RLS is a second layer; the API also enforces membership. A SQL injection or a bug in a future raw
  query could still be dangerous — keep parameterized queries and review new SQL.
- Webhook replay protection relies on dedupe keys and durable events; Meta retries for up to 36 hours.
  The current dedupe is per account/field/comment id; a malicious actor with a valid signature is
  outside the threat model (they would need the app secret).
- Logs redact secrets and tokens, but operators must still avoid logging raw request bodies in their
  hosting platform. The API does not log tokens or authorization headers.
- No penetration test, SOC 2, HIPAA or GDPR certification is claimed. Complete a legal/privacy review
  before processing real user data.
