# CommentPilot — Instagram comment automation SaaS

A production-minded, multi-tenant SaaS for turning Instagram comments into confirmed replies. Workspace
members connect Instagram professional accounts with the official **Instagram API with Instagram
Login**, choose posts or Reels, define keyword triggers, and send a public reply plus an optional
one-time private reply with a tracked resource link.

> **Status (17 Oct 2026):** functional full-stack MVP, verified locally and in CI-style test runs.
> It has **not** been deployed to a public environment and has **not** been exercised against a live
> Meta app or real Instagram account. Meta App Review and Advanced Access are prerequisites for
> real traffic — see [docs/LIMITATIONS.md](docs/LIMITATIONS.md) and [docs/SETUP.md](docs/SETUP.md).

## What is implemented

- **Auth and tenancy** — Supabase Auth in the browser; the Express API verifies every JWT and enforces
  workspace membership server-side. Postgres RLS is enabled on every tenant table as defence in depth.
- **Instagram connection** — official Instagram Login OAuth (no Facebook Page required), single-use
  hashed `state`, AES-256-GCM token encryption at rest, token refresh, webhook subscription, media
  sync, disconnect and delete flows.
- **Webhook pipeline** — `GET` verification handshake, timing-safe `X-Hub-Signature-256` validation,
  durable event storage before ACK, deduplication, idempotent processing and bounded retries.
- **Automation engine** — case-insensitive whole-word multi-keyword matching, post/Reel scoping,
  rule priority, public reply and one private reply per comment (7-day window), 700/hour local private
  reply budget below Meta's limit.
- **Dashboard** — Overview, accounts, automations list, rule builder with test mode, resource library,
  activity and delivery logs, analytics, usage and plan limits, workspace settings and members.
- **Analytics and quotas** — comments, matches, attempted/confirmed sends, failures, duplicates,
  clicks and monthly usage with atomic quota enforcement.
- **Operations** — versioned SQL migrations, health/readiness endpoints, structured logs with secret
  redaction, rate limits, graceful shutdown, retention cleanup.
- **Tests** — 149 automated tests (unit, API integration, real-Postgres schema/RLS, React UI) plus
  opt-in live Meta tests that are skipped without credentials.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router 7, Radix UI primitives, Sonner |
| Backend | Node.js 22, Express 5, TypeScript, Zod 4, Pino |
| Data | Supabase PostgreSQL, SQL migrations, RLS, atomic SQL functions |
| Auth | Supabase Auth (browser) + server-side JWT verification (JWKS or HS256) |
| Integration | Instagram API with Instagram Login (`graph.instagram.com`) |
| Queue | PostgreSQL table claimed with `FOR UPDATE SKIP LOCKED`; no Redis |

## Quick start (demo, no credentials)

```bash
npm install
cp client/.env.example client/.env.local   # VITE_DEMO_MODE=true is already set
npm run dev:demo                           # client only (no database or API required)
```

Open <http://localhost:5173>. The client runs an **in-browser demo backend** with clearly-labelled
sample data. It makes no Instagram calls and sends nothing. `npm run dev` starts the API too and
requires a configured database; use it only for real mode.

## Quick start (real mode)

1. Create a Supabase project and apply the migrations:
   ```bash
   export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
   npm run db:migrate
   ```
2. Copy and fill the server env file:
   ```bash
   cp .env.example .env
   # Set DATABASE_URL, DATABASE_SSL=true, SUPABASE_URL, SUPABASE_ANON_KEY,
   # TOKEN_ENCRYPTION_KEY, META_APP_ID, META_APP_SECRET, META_REDIRECT_URI,
   # META_WEBHOOK_VERIFY_TOKEN, CLIENT_ORIGIN, API_PUBLIC_URL.
   ```
3. Point the browser build at Supabase and the API in `client/.env.local`:
   ```bash
   VITE_DEMO_MODE=false
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>
   VITE_API_BASE_URL=http://localhost:3001
   ```
4. Run `npm run dev`, create an account, then connect an Instagram professional account from
   **Connected accounts**.

The complete Meta app configuration (redirect URL, deauthorize/data-deletion callbacks, webhook fields,
permissions and App Review) is in [docs/SETUP.md](docs/SETUP.md).

## Repository layout

```
client/                 React dashboard (Vite, TypeScript, Tailwind)
  src/pages/            Overview, accounts, automations, resources, activity, analytics, usage, settings
  src/context/          Auth and workspace contexts
  src/test/             Vitest + Testing Library suites
server/
  src/app.ts            Express app factory (dependency injection)
  src/modules/          REST routers (workspaces, accounts, rules, resources, runs, insights, webhooks)
  src/automation/       Matcher, templates, engine, Postgres-backed worker
  src/integrations/     Instagram Login OAuth + Graph provider, error classification, capabilities
  src/db/               Store interface, PgStore, migrations
  test/                 unit, api, db (PGlite), live (opt-in)
supabase/migrations/    Versioned schema, RLS, functions, plans, auth hook
supabase/tests/         SQL RLS suite for a hosted Supabase project
docs/                   Feasibility, architecture, security, plan, setup, deployment, limitations, API
```

## Architecture in one minute

The browser talks only to the Express API and Supabase Auth. The API validates the Supabase JWT,
resolves the workspace membership, and uses a direct Postgres connection for all reads/writes.
Instagram tokens are decrypted only inside the server for a specific outbound call. Meta webhooks are
verified and written to `webhook_events` before a `200` is returned; an in-process worker claims queued
jobs with `SKIP LOCKED`, executes the matching rule, and records only confirmed IDs returned by Meta.
A single Node service plus PostgreSQL keeps the MVP cheap and avoids unnecessary microservices or
Redis. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and trade-offs.

## Security highlights

- Instagram tokens encrypted at rest with AES-256-GCM, key versioning and account-bound AAD; never
  returned to the browser and excluded from logs and RLS-visible columns.
- Meta app secret, Supabase service-role key and token encryption key are server-only.
- OAuth `state` is 32 random bytes, stored hashed, single-use, 10-minute TTL and bound to user +
  workspace. Redirect URIs are exact-match.
- Webhook signatures are verified against the raw body with a timing-safe comparison; invalid
  requests are rejected before parsing.
- Server-side tenant authorization on every route + RLS policies + composite tenant foreign keys.
- Helmet, CORS allowlist, body size limits, Zod validation on params/bodies/queries, rate limits on
  auth/OAuth/webhook/mutation endpoints, request IDs and redacted error responses.
- Deauthorize and data-deletion callbacks, disconnect/delete workflows, and a 30-day webhook payload
  retention job.

Details and residual risks: [docs/SECURITY.md](docs/SECURITY.md).

## Tests and checks

```bash
npm test               # server unit/API + Postgres schema/RLS (PGlite) + client UI
npm run test:live      # opt-in real Meta API checks; skipped unless LIVE_META_TESTS=1
npm run typecheck
npm run lint
npm run build
```

The database tests use in-process PGlite because the sandbox has no Docker or Supabase CLI. The same
migrations run on hosted Supabase. `supabase/tests/rls.test.sql` can be executed against a real
project with `psql` for a second isolation check. The client suite covers loading, empty, error/retry,
success, demo labelling and automation-builder validation. See [REPORT.md](REPORT.md) for the latest
results and environment caveats.

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Supabase, Meta app, env vars, migrations, webhook testing, troubleshooting |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Hosting topology, cost model, production checklist, operations |
| [docs/API.md](docs/API.md) | REST endpoints, payloads, errors, webhooks, auth |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | What is verified vs. conditional/unsupported; Meta approval gaps |
| [docs/META_API_FEASIBILITY.md](docs/META_API_FEASIBILITY.md) | Capability-by-capability Meta research with official sources |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Service, data, queue and tenancy design |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, retention and test matrix |
| [REPORT.md](REPORT.md) | Final implementation report and verification evidence |

## Honest capability statement

- **Follow verification is not supported.** Meta does not expose follower status for arbitrary
  commenters at comment time. The UI marks it *Unsupported*; the API returns `422
  CAPABILITY_UNAVAILABLE` for `followGate: "verify"`. The supported alternative is a follow
  *instruction* in the private reply. Resource clicks are measured but are never treated as proof.
- **Real delivery requires Meta approval.** Comment webhooks and replies need Advanced Access
  (`instagram_business_manage_comments`), an app in Live mode, a public HTTPS host and a public
  professional account. Until then, the integration fails closed with actionable errors.
- **Mocks are separated from real integrations.** Tests use a fake provider; demo mode is in-browser
  sample data and every sample row is labelled. Live Meta tests are opt-in and skipped by default.

## License

No license has been chosen for this repository. Treat it as private/proprietary until one is added.
