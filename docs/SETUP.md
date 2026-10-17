# Setup Guide

**Last verified:** 2026-10-17. Commands assume the repository root. Do not paste real secrets into
chat, issues, commits or screenshots; keep them in `.env` / `client/.env.local`, which are gitignored.

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js >= 20.19 (verified on 22.22.3) | npm 10+; the repo uses npm workspaces |
| Supabase project | Free tier is sufficient for development. Auth + PostgreSQL required. |
| Meta developer app | Type **Business**, with the Instagram product and **API setup with Instagram login** |
| Instagram professional account | Business or Creator, public, owned by the tester |
| HTTPS host for real Meta traffic | OAuth redirect and webhook URLs must be publicly reachable and match exactly |

No Docker, Redis or Supabase CLI is required. The migration runner and tests connect directly to
Postgres; PGlite provides a real Postgres engine for tests.

## 2. Install and demo mode

```bash
npm install
cp client/.env.example client/.env.local     # VITE_DEMO_MODE=true is already set
npm run dev:demo                             # client only; no DB/API needed
```

- Client: <http://localhost:5173>
- API (real mode only): <http://localhost:3001> (`/api/health`, `/api/ready`)

`npm run dev` starts both the API and the client, so it requires a valid `.env` with `DATABASE_URL`
(or a fully configured Supabase/Meta deployment). Use `npm run dev:demo` for the credential-free UI
review.

Demo mode uses `client/src/lib/demo.ts`, an **in-browser fake backend** with sample workspaces, rules,
runs and resources. It never calls Instagram or the Express API. The UI shows a persistent demo banner
and a `Sample` badge on every imported run. Do not enable demo mode in a customer-facing production
build.

To exercise the real API locally without Supabase, set `DEMO_MODE=true` in the **server** `.env`. This
uses a fixed local identity (`00000000-0000-4000-8000-000000000001`) but still reads/writes the real
database. It is rejected when `NODE_ENV=production`.

## 3. Supabase

### 3.1 Create the project

1. Create a project at <https://supabase.com/dashboard>. Save the database password.
2. In **Project Settings → Database**, copy a connection string. Use the **Session pooler** (port
   5432) or direct connection for the API and migration runner. The transaction pooler (port 6543)
   does not support all session features used by migrations; prefer the session pooler.
3. Set `DATABASE_SSL=true` for Supabase. The driver verifies the server certificate.

### 3.2 Apply migrations

```bash
export DATABASE_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
export DATABASE_SSL=true
npm run db:migrate
```

The runner applies `supabase/migrations/0001…0005` in filename order inside transactions and records
each file in `public.schema_migrations`. Re-running is idempotent. Migrations create:

- tenant tables, constraints, indexes and composite tenant foreign keys;
- RLS policies and least-privilege grants (`app.*` helpers, no token columns for browser roles);
- atomic usage functions, retention functions and the plan catalogue;
- an optional auth trigger that creates a `profiles` row on signup.

If your project already has data, take a backup before applying migrations. Migrations are additive;
there are no destructive down-migrations.

### 3.3 Auth configuration

1. **Authentication → Providers → Email**: enable email/password. For local development you may turn
   off “Confirm email”; for production keep confirmation on and configure SMTP.
2. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173` in development, your HTTPS client origin in production.
   - Additional redirect URLs: the same origins plus any preview origins you actually use.
3. The browser uses PKCE and persists the session in local storage. The API independently verifies
   the access token on every request.
4. Optional: run `supabase/tests/rls.test.sql` with `psql "$DATABASE_URL" -f supabase/tests/rls.test.sql`
   against a disposable project to verify RLS with the real Supabase roles.

### 3.4 Keys

| Key | Where it goes | Exposure |
| --- | --- | --- |
| Project URL | `SUPABASE_URL`, `VITE_SUPABASE_URL` | Public |
| `anon` key | `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` | Public by design (RLS still applies) |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` (server only) | **Secret.** Never in the client build. |
| Database password / URL | `DATABASE_URL` (server only) | **Secret** |
| JWT secret (legacy projects) | `SUPABASE_JWT_SECRET` (server only) | **Secret**; prefer JWKS via `SUPABASE_URL` |

## 4. Environment variables

Copy `.env.example` to `.env` at the repository root. Every value is validated at startup by
`server/src/config/env.ts`.

### Required for a real (non-demo) server

| Variable | Example | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables fail-closed checks and `trust proxy` |
| `DATABASE_URL` | `postgresql://…` | Session pooler/direct Postgres |
| `DATABASE_SSL` | `true` | Supabase requires TLS |
| `SUPABASE_URL` | `https://abcd.supabase.co` | Enables JWKS verification and `/api/config` |
| `SUPABASE_ANON_KEY` | `eyJ…` | Public browser key echoed to `/api/config` |
| `TOKEN_ENCRYPTION_KEY` | output of `openssl rand -base64 32` | 32 bytes, base64. Losing/changing it makes stored tokens undecryptable |
| `CLIENT_ORIGIN` | `https://app.example.com` | CORS + OAuth return redirect |
| `API_PUBLIC_URL` | `https://api.example.com` | Tracked links and data-deletion status URL |
| `META_APP_ID` | numeric | Instagram App ID |
| `META_APP_SECRET` | hex | Instagram App Secret (server only) |
| `META_REDIRECT_URI` | `https://api.example.com/api/integrations/instagram/callback` | Must match Meta exactly |
| `META_WEBHOOK_VERIFY_TOKEN` | long random string | Must match Meta webhook config |
| `META_SCOPES` | `instagram_business_basic,instagram_business_manage_comments` | Add `..._manage_messages` only if you need private replies |

### Optional / tuning

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `LOG_LEVEL` | `info` | `silent` in tests |
| `CORS_ORIGINS` | empty | Extra comma-separated browser origins |
| `SUPABASE_JWT_SECRET` | empty | HS256 fallback when JWKS is unavailable; keep server-only |
| `META_GRAPH_VERSION` | `v25.0` | Pin a supported version; check the Graph changelog before upgrading |
| `META_WEBHOOK_FIELDS` | `comments` | `live_comments` is stored but unsupported for automation |
| `TOKEN_KEY_VERSION` | `1` | Stored with ciphertext for rotation |
| `OAUTH_STATE_TTL_SECONDS` | `600` | OAuth state lifetime |
| `WORKER_ENABLED` | `true` | In-process worker; disable only for a dedicated worker deployment |
| `WORKER_CONCURRENCY` | `2` | Parallel jobs per process |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Queue poll interval |
| `WORKER_MAX_ATTEMPTS` | `5` | Bounded retries; permanent errors are never retried |
| `PRIVATE_REPLIES_PER_HOUR` | `700` | Local budget under Meta's 750/hour/account limit |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `30` | Unauthenticated auth/limit scope |
| `WEBHOOK_RATE_LIMIT_PER_MINUTE` | `600` | Per IP; do not set below Meta's delivery bursts |
| `MUTATION_RATE_LIMIT_PER_MINUTE` | `120` | Workspace mutations |
| `DEMO_MODE` | `false` | Server-side demo identity; rejected in production |
| `FOLLOW_VERIFICATION_ENABLED` | `false` | **The server refuses to start if true**; Meta does not expose this capability |
| `AI_SUGGESTIONS_ENABLED` | `false` | Reserved. Enabling it does not currently expose AI in the API/UI; only the template fallback and validation/budget scaffolding exist |

### Browser variables (`client/.env.local`)

| Variable | Notes |
| --- | --- |
| `VITE_DEMO_MODE` | `true` for the in-browser sample; `false` for real mode |
| `VITE_API_BASE_URL` | API origin, or empty to use the Vite dev proxy |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key |

Only `VITE_` variables are embedded in the browser bundle. Never put a service-role key, database URL,
Meta app secret or token encryption key in a `VITE_` variable.

## 5. Meta app configuration

Follow the official Meta documentation; the feasibility study records the exact sources and statuses.
The setup below is for **Instagram API with Instagram Login** (no Facebook Page required).

1. Create an app at <https://developers.facebook.com/apps> with type **Business**.
2. Add the **Instagram** product and choose **API setup with Instagram login**.
3. Under **Instagram → Business login**, set:
   - **Redirect URL**: exactly `META_REDIRECT_URI`
     (`https://<api-host>/api/integrations/instagram/callback`).
   - **Deauthorize callback URL**: `https://<api-host>/api/webhooks/instagram/deauthorize`.
   - **Data deletion request URL**: `https://<api-host>/api/webhooks/instagram/data-deletion`.
4. Under **Webhooks**, set:
   - Callback URL: `https://<api-host>/api/webhooks/instagram`.
   - Verify token: exactly `META_WEBHOOK_VERIFY_TOKEN`.
   - Subscribe to the `comments` field (add `live_comments` only for storage; automation is rejected).
5. Request scopes `instagram_business_basic` and `instagram_business_manage_comments`. Add
   `instagram_business_manage_messages` only if you will send private replies.
6. During development, add test users/accounts under **App roles**. Test Instagram accounts must be
   professional and public.
7. Submit **App Review** with Advanced Access for the comment scopes and provide screencasts of the
   exact flows. Set the app to **Live** only after review. Without Advanced Access, only app
   testers' accounts will work and production webhooks will not be delivered for everyone.

Exact URLs, permissions and restrictions are in
[`docs/META_API_FEASIBILITY.md`](META_API_FEASIBILITY.md) §2–§12.

## 6. Run and connect an account

```bash
npm run dev          # API :3001 + client :5173
```

1. Sign up / sign in.
2. Create a workspace.
3. Open **Connected accounts → Connect Instagram**. The API returns the official authorization URL;
   the browser is sent to `https://www.instagram.com/oauth/authorize`.
4. Approve the scopes. Meta redirects to the API callback; the API validates `state`, exchanges the
   code for a short-lived token, exchanges that for a 60-day token, encrypts it, stores the account and
   asks Meta to subscribe the app to webhooks.
5. Sync media and create an automation. Use **Test mode** to render a template without sending.
6. Keep the app's webhook subscription and permissions in sync when Meta changes your app settings.

## 7. Webhook testing without Meta

### Verification handshake

```bash
curl -i "http://localhost:3001/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=$META_WEBHOOK_VERIFY_TOKEN&hub.challenge=test123"
# 200 text/plain body: test123
```

### Signed POST

```bash
BODY='{"object":"instagram","entry":[{"id":"17841400000000001","time":1790000000,"changes":[{"field":"comments","value":{"id":"comment-1","text":"API please","from":{"id":"igsid-1","username":"reader"},"media":{"id":"media-1"}}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | awk '{print $2}')
curl -i -X POST http://localhost:3001/api/webhooks/instagram \
  -H 'content-type: application/json' \
  -H "x-hub-signature-256: sha256=$SIG" \
  --data "$BODY"
```

`200` means the event was persisted (or recognized as a duplicate), not that a reply was sent.
`401` means the signature or raw body did not match. Delivery results appear in **Activity** after the
worker processes the queued job. The payload requires `entry[0].id` to match a connected account's
Instagram professional account id.

## 8. Tests

```bash
npm test                    # server unit/API + DB/RLS + client UI
npm run test:server         # server unit + API integration (memory test store + fake provider)
npm run test:db             # migrations, RLS and store against PGlite (real Postgres)
npm run test:client         # React Testing Library suites
npm run test:live           # opt-in real Meta checks, skipped by default
```

Live tests require `LIVE_META_TESTS=1` and `IG_LIVE_ACCESS_TOKEN`; they are read-only unless
`LIVE_META_ALLOW_WRITES=1` **and** `IG_LIVE_COMMENT_ID` are also set. See
`server/test/live/meta.live.test.ts`. Never point write tests at a customer account.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY is required` | Set a base64 32-byte key in production; do not rotate it without reconnecting accounts |
| `SUPABASE_URL … required in production` | Set `SUPABASE_URL` (JWKS) or the legacy `SUPABASE_JWT_SECRET` |
| API 401 in the browser | Supabase session expired or `VITE_SUPABASE_*` points at a different project than the API |
| OAuth callback `state` invalid | Redirect URL/origin mismatch, expired state (10 min), reused state, or API restarted with a different DB |
| `NOT_CONFIGURED` on OAuth/webhook/reply | One of the four `META_*` values is missing; restart the API after changing env |
| Webhook returns 401 | Wrong `META_APP_SECRET` or a proxy changed/re-serialized the raw body |
| Webhook returns 200 but no activity | No connected account matches `entry[].id`, no enabled rule matches, or worker is disabled |
| `CAPABILITY_UNAVAILABLE` when saving a rule | `followGate: "verify"` is intentionally unsupported; use `"instruction"` |
| Private reply skipped | Outside the 7-day window, quota exhausted, or account not connected; see the run event |
| `needs_reconnect` account | Meta returned token error 190 or a token subcode; reconnect the account |
| Migration fails with SSL errors | Set `DATABASE_SSL=true`; use the session pooler/direct connection |
| Demo data appears in a real deployment | `VITE_DEMO_MODE=true` was baked into the build; rebuild with `false` |
