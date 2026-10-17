# Deployment and Cost Guide

**Last updated:** 2026-10-17. Pricing and free-tier terms change frequently. **Verify the linked
provider pages before deploying or promising a price.** The numbers below are the assumptions used for
the design, not a quote.

## 1. Recommended topology (near-zero MVP)

```
Browser (static React build)
        │  HTTPS + Supabase JWT
        ▼
Express API + in-process worker (one Node service, 1 instance)
        │  direct Postgres (TLS)
        ▼
Supabase PostgreSQL + Auth + RLS
        ▲
        │  HTTPS webhooks (verified)
   Meta / Instagram
```

- **Client:** static files on Vercel, Netlify, Cloudflare Pages or any CDN.
- **API + worker:** one long-running Node service (Render, Railway, Fly.io, a small VM, or a container
  platform). It must accept public HTTPS traffic for OAuth and webhooks.
- **Database/Auth:** Supabase.
- **No Redis, no second service, no scheduler SaaS.** The worker and maintenance interval run inside
  the API process. A dedicated worker deployment is optional at higher volume (see §7).

This topology is intentionally one process: Instagram comment volume for a new workspace is low, and
Postgres `SKIP LOCKED` is enough. Avoid microservices until a measured bottleneck exists.

## 2. Build and start

```bash
npm ci
npm run build                 # server tsc + client vite build
npm run typecheck
npm test                      # run in CI before deploying
NODE_ENV=production npm --workspace server start
```

Build outputs:

- `server/dist/` — compiled Express app; start with `node server/dist/index.js` (or the workspace
  `start` script).
- `client/dist/` — static assets to upload to the CDN/host.

The client is a Single Page App; configure a fallback so all non-file paths serve `index.html`.
`/api` requests must be routed to the Express service. Either:

1. set `VITE_API_BASE_URL=https://api.example.com` at build time and enable CORS, or
2. proxy `/api` from the CDN/host to the API (same-origin, simpler cookies/CORS story; auth uses
   bearer tokens, not cookies).

The Vite dev server proxies `/api` to `http://127.0.0.1:3001`. In production, use the platform's
rewrite/proxy configuration or `VITE_API_BASE_URL`.

## 3. Production environment

Set at least:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://...          # session pooler / direct, TLS
DATABASE_SSL=true
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
TOKEN_ENCRYPTION_KEY=<base64 32 bytes>
CLIENT_ORIGIN=https://app.example.com
API_PUBLIC_URL=https://api.example.com
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=https://api.example.com/api/integrations/instagram/callback
META_WEBHOOK_VERIFY_TOKEN=<random>
META_SCOPES=instagram_business_basic,instagram_business_manage_comments
META_WEBHOOK_FIELDS=comments
DEMO_MODE=false
FOLLOW_VERIFICATION_ENABLED=false
WORKER_ENABLED=true
```

Optional: `CORS_ORIGINS`, `SUPABASE_JWT_SECRET` (legacy HS256), `META_GRAPH_VERSION`,
`PRIVATE_REPLIES_PER_HOUR`, rate limits, worker concurrency.

For the client build:

```dotenv
VITE_DEMO_MODE=false
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon>
VITE_API_BASE_URL=https://api.example.com
```

The API refuses to start in production when `DEMO_MODE`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL` or
auth verification settings are unsafe/missing. See `server/src/config/env.ts`.

## 4. Migrations

Run before the new API version receives traffic:

```bash
DATABASE_URL=... DATABASE_SSL=true npm run db:migrate
```

Recommended: a release/CI job or a one-off shell on the host. The runner is idempotent and records
applied files in `public.schema_migrations`. Do not run migrations concurrently from multiple release
jobs unless the deploy platform serializes releases. Take a Supabase backup before the first
production migration.

## 5. HTTPS, proxy and webhook constraints

- Meta requires public **HTTPS** callback URLs. Terminate TLS at the host/proxy.
- The API must receive the **raw webhook body** unmodified. `express.json()` captures `rawBody` before
  parsing; a proxy that re-serializes JSON will invalidate `X-Hub-Signature-256`.
- Forward the original client IP (`X-Forwarded-For`). The app sets `trust proxy` when
  `NODE_ENV=production` for rate limiting.
- `CLIENT_ORIGIN` must exactly match the browser origin (scheme + host + port). Add preview origins to
  `CORS_ORIGINS` only if needed; do not use `*` with credentials (the app does not use cookie auth).
- `API_PUBLIC_URL` must be the externally reachable HTTPS origin: it builds tracked
  `https://api.../r/<slug>` links and the Meta data-deletion status URL.

## 6. Host choice and cost model

All prices are **monthly, USD, excluding tax**, and must be re-checked at deploy time.

| Component | MVP choice | Approx. cost | Free-tier caveats to verify |
| --- | --- | --- | --- |
| Database + Auth | Supabase Free | $0 | Project pauses after inactivity (historically 7 days); ~500 MB database; no automated backups; MAU and bandwidth caps. Fine for demos, not for paying customers. |
| Database + Auth | Supabase Pro | ~$25 | Daily backups, no pausing, higher limits, spend caps. Confirm current inclusions. |
| API + worker | Render/Railway/Fly free or starter | $0–$10 | Free instances sleep/cold-start and may have request/hour or memory limits; webhooks may time out while waking. Use an always-on starter for real traffic. |
| API + worker | Small VM (1 vCPU/1 GB) | $5–$12 | You manage OS, TLS proxy, deploys, backups and monitoring. |
| Client | Vercel/Netlify/Cloudflare Pages | $0–$20 | Static hosting free tiers are usually sufficient; commercial limits and seats vary. |
| Domain + TLS | Registrar + host | ~$12/year + $0 | TLS is usually included by the host. |
| Error monitoring (optional) | Sentry free tier | $0 | Verify event quota; the app logs structured JSON to stdout instead. |
| Email confirmation/SMTP | Supabase built-in or Resend free tier | $0 | Supabase's default SMTP is rate-limited and not for production volume; verify. |

**Near-zero MVP:** Supabase Free + a free API host + static CDN = **$0**, acceptable only for
development and demos. The main risks are cold starts (missed/timed-out Meta webhooks) and the paused
project (OAuth/webhooks stop entirely).

**Small production:** Supabase Pro (~$25) + always-on API (~$7) + static client ($0) + domain
(~$1/month) ≈ **$33/month** before email/monitoring. This is the realistic baseline for paying
customers. Meta API usage itself has no per-call charge, but rate limits and App Review apply.

Before committing to a provider, verify: monthly price, always-on behavior, outbound bandwidth,
WebSocket support (not needed), maximum request timeout, health checks, log retention, and how the
platform handles raw request bodies and `X-Forwarded-For`.

## 7. Scaling and operations

| Concern | Current behavior | Next step |
| --- | --- | --- |
| Webhook bursts | Persist then queue; ACK is not blocked on Instagram calls | Increase `WORKER_CONCURRENCY`; add a dedicated worker process |
| Multiple API instances | Safe: queue uses `SKIP LOCKED`; OAuth state and dedupe are in Postgres | Run the worker in only one deployment, or scale workers horizontally |
| DB connections | Pool max 10 per process | Use the session pooler and a small number of instances, or add PgBouncer |
| Token refresh | Every 6 hours in the API process, plus on-demand endpoint | Keep one scheduler instance, or move to Supabase Cron |
| Retention | Webhook payloads deleted after 30 days; OAuth states cleaned up | Tune `purgeOldData(30)` and document your privacy policy |
| Rate limiting | In-memory, per instance | For multi-instance global limits, add a shared store (not required for MVP) |
| Observability | Pino JSON logs to stdout, request IDs, health endpoints | Ship logs to the platform; add uptime checks and alerting |

Health endpoints:

- `GET /api/health` — liveness, no DB call.
- `GET /api/ready` — verifies the database connection (returns `503` when not ready).
- `GET /api/config` — public, non-secret capability/configuration summary for the UI.

Graceful shutdown stops the worker, closes the HTTP server (10 s limit) and the pool. Give the platform
a termination grace period longer than 10 seconds.

## 8. Security checklist before going live

- [ ] `NODE_ENV=production`, `DEMO_MODE=false`, `FOLLOW_VERIFICATION_ENABLED=false`.
- [ ] `TOKEN_ENCRYPTION_KEY` stored in the platform's secret manager, backed up securely, not in Git or
      the client bundle.
- [ ] `META_APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` server-only.
- [ ] Exact HTTPS redirect URI, deauthorize URL, data-deletion URL and webhook callback registered in
      the Meta app.
- [ ] Webhook verify token is long/random and matches Meta.
- [ ] CORS origins restricted to the real client origin(s).
- [ ] Supabase Auth email confirmation + SMTP configured; redirect URLs restricted.
- [ ] Migrations applied; RLS enabled; `supabase/tests/rls.test.sql` run against a staging project.
- [ ] `npm test`, typecheck, lint and production builds green; live Meta tests executed against a test
      account with writes explicitly enabled.
- [ ] Backups enabled (Supabase Pro or an external `pg_dump` schedule).
- [ ] Privacy policy/retention notice published; data-deletion and deauthorize callbacks return valid
      responses.
- [ ] Uptime check on `/api/ready`; alerting on 5xx and worker dead-letter growth.

## 9. Meta release checklist

1. App type **Business**, Instagram product with **API setup with Instagram login**.
2. Redirect/deauthorize/data-deletion URLs configured for production.
3. Webhook callback verified and subscribed to `comments`.
4. Advanced Access approved for `instagram_business_basic` and
   `instagram_business_manage_comments`; `instagram_business_manage_messages` only if sending DMs.
5. Screencasts show the exact OAuth, rule creation, comment, public reply and private reply flows.
6. App switched to **Live**.
7. Test with a non-tester public professional account, from a comment to a confirmed reply, and verify
   the run shows Meta-returned IDs.
8. Monitor error codes 190/463/467 (token), 10/200–299 (permissions), 4/17 (rate limit), 100 (invalid)
   and the account status in the dashboard.

## 10. Rollback

- Keep the previous server build and client assets; redeploy the previous version.
- Migrations are additive; do not roll back the schema unless you have a tested down-migration. If a
  release is bad, roll back the app and leave the schema in place.
- If token encryption keys are rotated incorrectly, accounts become undecryptable and must reconnect;
  keep the old key available until all tokens are re-encrypted or accounts are reconnected.
