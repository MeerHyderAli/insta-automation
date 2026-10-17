# Project Status Report — CommentPilot

**Date:** 17 October 2026
**Branch:** `arena/80f4afbf-insta-automation`
**Status:** Full-stack MVP complete and verified locally. **Not deployed** and **not exercised against a
live Meta app or real Instagram account** — those steps need operator credentials and Meta approval.

---

## 1. Executive summary

The repository contains a working, security-conscious multi-tenant Instagram comment-automation SaaS:

- **Backend:** Node.js 22 + Express 5 + TypeScript, modular REST API, PostgreSQL/Supabase data layer,
  encrypted Instagram tokens, official Instagram Login OAuth, signed webhooks, durable Postgres queue,
  bounded retries, atomic quotas, and an optional AI-provider scaffold.
- **Frontend:** React 19 + Vite 8 + TypeScript + Tailwind 4 + React Router 7, 15 route components,
  accessible Radix-based UI, loading/empty/error/success states, and clearly-labelled demo data.
- **Database:** 5 versioned SQL migrations, 18 tables, RLS on every tenant table, least-privilege grants,
  composite tenant foreign keys, and server-only tables for tokens, webhooks and jobs.
- **Documentation:** Phase Zero deliverables plus a complete README, setup, deployment/cost, API,
  limitations and security reference.
- **Verification:** typecheck, format check, lint, production builds and **149 automated tests pass**
  (116 server unit/API, 23 database/schema/RLS, 10 client UI). Live Meta tests are written but skipped
  without credentials.

The headline caveat is unchanged: **real Instagram OAuth, webhooks and replies have not been executed
against Meta from this sandbox.** They are implemented from official documentation and exercised through
a fake provider. The exact remaining operator steps and test protocol are in §8 and
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

---

## 2. What is implemented

### 2.1 Documentation

| Document | Contents |
| --- | --- |
| `docs/META_API_FEASIBILITY.md` | Capability-by-capability Meta research with official URLs, permissions, prerequisites, restrictions and status |
| `docs/ARCHITECTURE.md` | Service layout, request/webhook flows, data model, queue, tenancy and scaling decisions |
| `docs/SECURITY.md` | Threat model, token encryption, webhook/OAuth controls, retention, residual risks, test matrix |
| `docs/IMPLEMENTATION_PLAN.md` | Phased plan, acceptance criteria and definition-of-done mapping |
| `docs/SETUP.md` | Supabase, Meta app, env vars, migrations, webhook curl tests, troubleshooting |
| `docs/DEPLOYMENT.md` | Topology, hosting/cost model, production checklist, scaling, rollback |
| `docs/LIMITATIONS.md` | Verified vs. conditional/unsupported capabilities and intentional MVP gaps |
| `docs/API.md` | Route reference, payloads, errors, quotas, webhooks and CORS |
| `README.md` | Product overview, quick starts, repository map, security summary, status |

### 2.2 Database (`supabase/migrations/`)

- `0001_schema.sql` — `profiles`, `plans`, `workspaces`, `workspace_members`, `instagram_accounts`,
  `instagram_media`, `resources`, `resource_clicks`, `automation_rules`, `oauth_states`,
  `webhook_events`, `automation_runs`, `automation_run_events`, `automation_jobs`, `usage_records`,
  `audit_events`, `meta_data_requests`. UUID keys, foreign keys, composite tenant constraints,
  indexes, unique `(account_id, comment_id)` runs, webhook dedupe keys, one job per event.
- `0002_rls.sql` — RLS enabled on every tenant table with explicit SELECT/INSERT/UPDATE/DELETE
  policies, `app.*` helpers, column grants excluding token material, and no browser access to
  `oauth_states`, `webhook_events` or `automation_jobs`.
- `0003_functions.sql` — atomic `app.increment_usage` / `app.release_usage`, webhook/OAuth retention
  cleanup, grants to `service_role`.
- `0004_plans.sql` — free / creator / studio catalogue.
- `0005_auth_hook.sql` — optional Supabase Auth trigger; skipped when `auth.users` is absent (PGlite).
- `supabase/tests/rls.test.sql` — SQL isolation suite for a hosted Supabase project.

### 2.3 Backend (`server/`)

- **Config** — Zod-validated env, fail-closed production checks (DB, auth verification, encryption key,
  no demo mode, no unsupported follow verification).
- **Auth** — Supabase JWT verification via JWKS (HS256 fallback), issuer/audience/expiry checks,
  membership resolved per request; non-members get `404` so tenant existence is not confirmed.
- **Accounts/OAuth** — official Instagram Login, 32-byte single-use hashed state with a 10-minute TTL
  bound to user + workspace, code → short token → 60-day token, AES-256-GCM at rest with key version
  and account-bound AAD, token refresh, webhook subscription, media sync, disconnect/delete.
- **Webhooks** — timing-safe GET verification, HMAC-SHA256 over the raw body, rejection before parsing,
  durable persistence and dedupe, `200` only after storage, `live_comments` marked unsupported,
  deauthorize and data-deletion signed-request callbacks with status codes.
- **Automation engine** — whole-word case-insensitive multi-keyword matching, media-scoped rules,
  priority ordering, exactly one run per comment, public reply then one private reply, 7-day window,
  700/hour local budget, at-most-once private sends on ambiguous failures (`unknown`), typed Meta error
  classification (retry only transient/rate-limit).
- **Queue/worker** — Postgres `FOR UPDATE SKIP LOCKED`, 5 attempts, exponential backoff with jitter
  capped at one hour, dead-letter handling; no Redis.
- **Quotas** — atomic SQL increments, plan limits on accounts/rules/resources/members, monthly
  private-reply and processed-comment quotas.
- **AI scaffold** — provider interface, deterministic template fallback, output validation and a
  per-workspace daily budget. Disabled by default and not exposed in the API/UI; no paid AI calls.
- **Hardening** — helmet, CORS allowlist, request IDs, rate limits on auth/OAuth/webhook/mutation,
  strict Zod validation, body limits, central error envelope, secret redaction, graceful shutdown.

### 2.4 Frontend (`client/`)

15 route components: Login, Onboarding, OAuth landing, Overview, Connected accounts, Automations,
Automation editor (new/edit), Resource library, Activity/delivery logs, Analytics, Usage & plan limits,
Workspace settings, 404, plus the app shell and redirect helpers.

- The rule builder covers name, account, post/Reel, keywords, public/private templates with
  placeholders, resource, priority, enabled state, optional follow instruction and test mode.
- Validation blocks missing names/keywords/templates, unknown placeholders, resource placeholders
  without a resource and enabling a disconnected account. Server-side validation remains authoritative.
- Follow verification is shown as **Unsupported** with an official documentation link and no fake
  switch; the API returns `422 CAPABILITY_UNAVAILABLE` if a client tries `followGate: "verify"`.
- Every data view has loading, empty, error and success states. Destructive actions use typed
  confirmation dialogs.
- Demo mode is an in-browser fake backend, not a cosmetic overlay: a persistent banner and per-row
  `Sample` badges prevent sample runs from being mistaken for real delivery.

### 2.5 Tests

| Suite | Files | Tests | What it proves |
| --- | ---: | ---: | --- |
| Server unit | 7 | 47 | Matcher, templates, signatures, cipher, Meta errors, config, AI provider |
| Server API integration | 4 | 69 | Auth/tenancy, CRUD/validation, OAuth state/callback, webhook verify/dedupe, engine retries/quotas |
| Database (PGlite) | 3 | 23 | Migrations, schema/RLS, tenant isolation, atomic quotas, webhook/run constraints, account status |
| Client (jsdom) | 2 | 10 | Dashboard loading/error/retry/empty/success/demo labels, rule-editor validation/follow gate |
| **Total** | **16** | **149** | |

`server/test/live/meta.live.test.ts` contains three opt-in tests (profile, media, optional reply). They
skip by default; a live run requires `LIVE_META_TESTS=1`, `IG_LIVE_ACCESS_TOKEN`, and for writes
`LIVE_META_ALLOW_WRITES=1` plus `IG_LIVE_COMMENT_ID`. The live suite cannot run in this sandbox because
no real credentials are available.

---

## 3. Verification evidence

Run on 17 October 2026 in the sandbox (Node 22.22.3, npm workspaces, no Docker/Supabase CLI):

| Check | Command | Result |
| --- | --- | --- |
| Server typecheck | `npm run typecheck` (workspace server) | **PASS** (exit 0) |
| Client typecheck | `npm run typecheck` (workspace client) | **PASS** (exit 0) |
| Format | `npm run format:check` | **PASS** |
| Lint | `npm run lint` | **PASS** — 0 errors, 13 warnings (hooks/exhaustive deps/console in scripts) |
| Server production build | `npm run build:server` | **PASS** (exit 0) |
| Client production build | `npm run build:client` | **PASS** — 2,081 modules, 590.75 kB JS (177.82 kB gzip), 39.52 kB CSS |
| Server unit/API tests | `npm --workspace server run test` | **116 / 116 passed** (11 files) |
| Database/RLS tests | `npm --workspace server run test:db` | **23 / 23 passed** (3 files) |
| Client tests | `npm --workspace client run test` | **10 / 10 passed** (2 files) |
| Live Meta tests | `npm run test:live` | **3 skipped by design** (no credentials) |
| Demo/production client build | `npm run build:client` | **PASS**, no secrets in bundle |

`npm test` runs the server, database and client suites together. CI (`.github/workflows/ci.yml`) also
runs format, typecheck, lint, tests and both builds.

### Bugs found and fixed by the integration tests

1. **Silent account-status failure (`PgStore.updateAccountStatus`).** The SQL used `$3` in both
   `last_error_code = $3` and a `CASE WHEN $3 IS NULL` expression. PGlite (and potentially some
   Postgres protocol/type-inference paths) could not infer `$3`, so the update threw; the engine
   swallowed it and an expired token left the account `connected`. Fixed with explicit `$3::text`,
   and the swallowed error now logs through Pino. A regression test covers the transition and clearing.
2. **OAuth reconnect left a stale webhook confirmation.** `completeOAuth` did not reset
   `webhook_subscribed_at`, so reconnecting with a new token could display “Confirmed by Meta” without
   re-subscribing. Reconnect now clears the timestamp and the OAuth suite asserts it.
3. **Error-code casing.** Account failure codes were `meta_190` while the rest of the API/UI uses
   `META_*`; normalized to `META_190` / `META_<code>`.
4. **Dedupe test assumption.** Replaying the same comment correctly returns the existing event row;
   the test now asserts the duplicate count and that no second run/reply is created, plus a separate
   new-dedupe-key case.
5. **Status rollup test.** A failed public reply with a delivered private reply is `partial`, not
   `failed`; the test now matches the engine's documented rollup.

---

## 4. Meta capability status (official docs only)

| Capability | Status | Notes |
| --- | --- | --- |
| Instagram Login OAuth (Business/Creator) | **VERIFIED (docs)** | Authorize → short token → 60-day token; refresh; no Facebook Page required |
| Comments webhook | **CONDITIONAL** | Advanced Access, app Live, public professional account; batched/retried, dedupe required |
| Public reply (`POST /<COMMENT_ID>/replies`) | **VERIFIED (docs)** | Returned `id` is the only delivery proof |
| Private reply (`POST /<IG_USER_ID>/messages`, `recipient.comment_id`) | **VERIFIED (docs)** | One per comment, 7-day window, text-only in this app |
| `live_comments` automation | **UNSUPPORTED (app)** | Stored but rejected for automation |
| Follower status at comment time | **UNSUPPORTED** | Not exposed by Meta; no scraping/fake verification |
| Follow check after a user DMs the app | **CONDITIONAL, not implemented** | Requires messaging consent and the User Profile API |
| Resource click tracking | **VERIFIED (first-party)** | Clicks are not follow proof |
| AI suggestions | **UNVERIFIED / disabled** | Provider interface, template fallback, validation and budget only |

---

## 5. Security acceptance criteria

| Requirement | Status |
| --- | --- |
| Encrypt IG tokens at rest with server-side key | Done — AES-256-GCM, key version, AAD binds token to account |
| Never return tokens to browser | Done — DTOs omit token fields; column grants exclude them; tests assert denial |
| Never log tokens/codes/secrets | Done — Pino redaction paths + free-text scrubber; OAuth errors never echo the code |
| Meta app secret / service role server-side | Done — server env only; `/api/config` exposes no secrets |
| OAuth state validation + redirect URI | Done — hashed, single-use, TTL, user/workspace bound, exact-match redirect |
| Validate bodies/params/query | Done — strict Zod schemas on all routes |
| Secure sessions | Supabase JWT verified server-side; PKCE in browser; bearer tokens only |
| Rate limiting | Auth, OAuth, webhook and mutation limiters; `Retry-After` exposed |
| Tenant ownership server-side | Membership per request; non-members receive 404 |
| Least privilege | RLS, column grants, server-only tables, no anon access |
| CSRF | Not applicable — no cookie auth; documented |
| Secure CORS | Explicit allowlist, credentials disabled |
| Replay protection | Dedupe keys, unique constraints, single-use OAuth state |
| Disconnect + deletion workflows | Token material wiped; account/workspace deletion cascades; Meta callbacks implemented |
| Retention/privacy documented | Done — `SECURITY.md`, `LIMITATIONS.md`, deployment checklist |
| No scraping/unofficial endpoints | Done — official Graph endpoints only |
| Automated security tests | Tenant isolation, token exposure, signature rejection, quota and state tests |

---

## 6. What is real, mocked, or blocked

**Real and working locally:**

- Schema, migrations, RLS and atomic quota functions on a real Postgres engine (PGlite).
- Express API with dependency injection, JWT verification (test verifier), tenant authorization,
  validation, rate limits and error envelopes.
- Token encryption, OAuth state lifecycle, webhook signature verification, dedupe, queue/backoff,
  keyword engine, template rendering, run/event logging and usage accounting.
- React dashboard with full CRUD UX and client-side demo data.

**Mocked / local only:**

- `server/test/helpers/api.ts` uses an in-memory store and a fake Instagram provider; tests never call
  Meta or Supabase.
- The browser demo uses `client/src/lib/demo.ts`, an in-browser fake backend labelled `Sample`, with
  no network or Instagram calls.
- `supabase/tests/rls.test.sql` and the live Meta suite are provided but have not run against hosted
  infrastructure here.

**Blocked on external factors:**

- Live Instagram OAuth, webhook delivery and replies: Meta Business app, Advanced Access/App Review,
  App Live, public HTTPS callback, public professional test account.
- Hosted Supabase RLS verification and deployment: project credentials and hosting authorization.
- Payment/billing, email invitation delivery and password-reset UI are product scope gaps, not
  external blockers (see §7).

---

## 7. Remaining gaps (not required for the local MVP)

1. **No payment provider/billing.** Plans and quotas exist; plan changes are DB/operational.
2. **No email invitations or password-reset screen.** Members must already have accounts; Supabase
   reset exists at the provider level but is not exposed in the UI.
3. **No messaging inbox/follow-up automation.** Only one private reply per comment; no 24-hour
   follow-up flow.
4. **AI is scaffolding only.** No route/UI, no paid provider.
5. **No live Meta/Supabase execution** (external credentials).
6. **No load/performance test or formal penetration test.**
7. **No deployment performed** (correctly, without explicit authorization).

---

## 8. Exact steps for the operator

### Credentials/configuration needed

- Supabase project URL, anon key, service-role key, database password/connection string.
- Meta **Business** app with Instagram product, **Instagram Login** setup, app ID/secret.
- Public HTTPS API host and client origin (Meta requires HTTPS for callbacks).
- Long random webhook verify token and a base64 32-byte token encryption key
  (`openssl rand -base64 32`).
- A public Instagram professional test account and an app tester role.
- Meta App Review/Advanced Access for `instagram_business_basic` and
  `instagram_business_manage_comments` (add `instagram_business_manage_messages` for DMs).

### Testing sequence

1. Apply migrations to Supabase: `DATABASE_URL=… DATABASE_SSL=true npm run db:migrate`.
2. Run `psql "$DATABASE_URL" -f supabase/tests/rls.test.sql` on a disposable project to confirm RLS
   with real Supabase roles.
3. Deploy API + client, set the exact redirect/deauthorize/data-deletion/webhook URLs in Meta.
4. Verify `GET /api/health` and `/api/ready`; configure the webhook callback and verify the handshake.
5. Connect the test account through the UI; confirm the account is `connected` and
   `webhookSubscribed=true`.
6. Create an enabled rule for a specific post. Comment the keyword from another account.
7. Confirm: webhook `200`, one run in Activity, public reply id, private reply message id, and the
   exact rendered text; verify duplicate redelivery does not create a second run.
8. Run `npm run test:live` with `LIVE_META_TESTS=1` and `IG_LIVE_ACCESS_TOKEN`; optionally enable the
   write test only on the test account.
9. Test failure paths: revoke the app token (expect `needs_reconnect`), remove a permission (expect
   `missing_permissions`), exhaust a plan quota (expect `429 QUOTA_EXCEEDED`).
10. Verify disconnect/delete and Meta deauthorize/data-deletion callbacks.

---

## 9. Cost posture

- **Supabase Free:** $0 for development/demo; historically ~500 MB DB, 50k MAU, 7-day inactivity
  pause, no automated backups. Not suitable for paying customers.
- **Supabase Pro:** ~$25/month (backups, no pausing) — verify current inclusions.
- **API host:** $0–$10/month; free tiers may sleep and miss/timeout webhooks. An always-on starter is
  recommended for real traffic.
- **Client:** static CDN free tier is sufficient.
- **Realistic small production:** ~$33/month before email/monitoring. No per-call Meta charge.
- **AI:** no paid provider wired; any future provider must be opt-in, budgeted and validated.

Full detail and caveats: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 10. Honest bottom line

The local definition of done is met: the app builds, auth and tenancy are implemented and tested,
migrations are reproducible, rules are fully manageable from the dashboard, matching/dedupe/retries and
quotas are tested, demo data is unmistakably labelled, follow verification is correctly rejected rather
than faked, and all documentation exists with no committed secrets.

The live definition of done is **not yet met** because no real Instagram, Supabase or deployed
environment has been exercised. That is an external-credential/approval gap, not an untested code path:
the live test suite, webhook test commands and operator checklist are ready. Do not describe the product
as delivering real Instagram replies until §8 is completed and the confirmed IDs are observed.
