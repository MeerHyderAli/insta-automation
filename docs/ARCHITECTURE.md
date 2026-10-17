# Architecture

**System:** multi-tenant Instagram comment automation SaaS
**Runtime:** React SPA + Express API + Supabase (Postgres/Auth) + in-process durable queue
**Last updated:** 2026-10-17

## 1. Goals and constraints

- Multiple independent workspaces; hard tenant isolation at the database (RLS) and API layers.
- Official Meta APIs only, behind a provider abstraction. No scraping or browser automation.
- Webhook acknowledgement is fast and durable; delivery work is asynchronous and idempotent.
- Near-zero operating cost for development; no Redis, no microservices, no paid AI dependency.
- Honest capability reporting. Unsupported Meta features (notably strict follow verification) are
  disabled with an explanation rather than simulated.

## 2. High-level topology

```
┌──────────────────────────┐        ┌────────────────────────────────────────────┐
│ Browser (React/Vite SPA) │        │ Express API (Node 20, TypeScript)          │
│                          │        │                                            │
│ Supabase Auth (browser)  │──JWT──▶ │  auth verifier → tenant middleware         │
│ API client (Bearer JWT)  │        │  modules: workspaces, accounts, rules,     │
└────────────┬─────────────┘        │  resources, runs, analytics, usage         │
             │                      │                                            │
             │                      │  /webhooks/instagram  (verify + persist)   │
             │                      │  /api/instagram/oauth/callback             │
             │                      │  worker loop (SKIP LOCKED queue)           │
             │                      └───────┬───────────────────────┬────────────┘
             │                              │                       │
             │                     service-role SQL          HTTPS (fetch)
             │                              │                       │
             ▼                              ▼                       ▼
      ┌─────────────┐              ┌──────────────┐        ┌────────────────────┐
      │ Supabase    │              │ Supabase     │        │ graph.instagram.com│
      │ Auth        │              │ Postgres+RLS │        │ api.instagram.com  │
      └─────────────┘              └──────────────┘        │ instagram.com      │
                                                           └────────────────────┘
```

Single deployable API process for the MVP. The worker runs inside it (`JOB_WORKER_ENABLED`) and can be
split into a separate process later without changing the queue contract.

## 3. Repository layout

```
/client                     React 19 + Vite + TypeScript + Tailwind 4
  src/components            design system, layout, shared UI
  src/pages                 route-level screens
  src/lib                   API clients (http + demo), auth, formatting
/server
  src/app.ts                Express app factory (dependency injection)
  src/index.ts              process entry: config, db, worker, HTTP
  src/config/env.ts         zod-validated environment
  src/auth                  Supabase JWT verification (local HS256 or Supabase API)
  src/middleware            auth, tenant resolution, rate limits, errors, request id
  src/modules/*             REST modules (routing + service + validation)
  src/integrations/instagram provider contract, Graph client, errors, capabilities
  src/automation            matcher, templates, engine, queue worker, rate budget
  src/db                    Postgres pool, migrations runner, store contracts
  test/unit                 pure and service tests (mocked Meta, memory store)
  test/db                   real-Postgres RLS tests via PGlite
  test/live                 opt-in live Meta integration tests (never run in CI by default)
/supabase/migrations        versioned SQL (schema, RLS, functions, seeds)
/supabase/tests             SQL test fixtures/harness
/docs                       feasibility, architecture, security, plan, setup, ops
```

## 4. Request flows

### 4.1 Authenticated API request

1. Browser authenticates with Supabase Auth and holds a short-lived access token.
2. API client sends `Authorization: Bearer <jwt>`.
3. `authMiddleware` verifies the JWT (local HS256 secret when configured, otherwise Supabase
   `auth.getUser`) and attaches `{ userId, email }`. It never trusts a user id from headers/body.
4. `workspaceMiddleware` loads the requested workspace and asserts membership (`owner|admin|member`)
   from `workspace_members`. It sets `req.workspace` + role.
5. Services scope **every** query by `workspace_id`. Privileged DB credentials never leave the server.
6. `errorHandler` returns a stable `{ error: { code, message, details? } }` shape without stack traces
   or secrets.

### 4.2 Connect an Instagram account

```
Browser → POST /api/workspaces/:id/instagram/oauth/start
           ↳ server generates 32-byte state, stores sha256(state), user, workspace, expiry
           ↳ returns authorize URL (client_id, redirect_uri, scopes, state)
Browser → instagram.com/oauth/authorize (user approves)
Browser → GET /api/instagram/oauth/callback?code&state
           ↳ server hashes state, atomically consumes the row (single use, 10 min TTL)
           ↳ exchange code → short-lived token (api.instagram.com)
           ↳ exchange short-lived → long-lived 60-day token (graph.instagram.com, server-side)
           ↳ fetch /me profile, verify permissions granted
           ↳ encrypt token (AES-256-GCM) → upsert instagram_accounts
           ↳ POST /me/subscribed_apps for comments/live_comments
           ↳ redirect to client /accounts?connected=1 (no token in URL)
```

Failure paths redirect with a stable `?error=` code; no secrets or raw Meta messages are placed in
URLs.

### 4.3 Webhook → automation

```
Meta → GET /webhooks/instagram           → verify token handshake
Meta → POST /webhooks/instagram (raw)    → X-Hub-Signature-256 verification
     ↳ parse/normalize defensively
     ↳ INSERT webhook_events ... ON CONFLICT (account_id, field, comment_id) DO NOTHING
     ↳ if inserted: INSERT automation_jobs (queued); if duplicate: counter only
     ↳ 200 OK  (no Meta calls, no waiting)
worker loop:
     ↳ claim job FOR UPDATE SKIP LOCKED, mark running
     ↳ load account (decrypt token) + enabled rules for the account/media
     ↳ match keywords case-insensitively; pick highest-priority matching rule
     ↳ create automation_run (unique per account+comment) — the idempotency anchor
     ↳ public reply  (claim → call Meta → record confirmed ID) 
     ↳ private reply (claim → window/limit checks → call Meta → record message ID)
     ↳ update run status + usage counters; ack job
     ↳ transient errors → backoff (30s · 2^n + jitter, max 5 attempts)
     ↳ permanent errors → failed with actionable code; no retry storm
```

## 5. Data model

| Table                 | Purpose                                                              | Tenant-owned |
| --------------------- | -------------------------------------------------------------------- | ------------ |
| `profiles`            | Mirror of `auth.users` identity (display name)                        | No (user)    |
| `workspaces`          | Tenant boundary, plan, timezone, settings                             | Yes (root)   |
| `workspace_members`   | Membership + role (`owner`, `admin`, `member`)                        | Yes          |
| `workspace_invites`   | Pending invitations by email (future role support)                    | Yes          |
| `instagram_accounts`  | Connected professional accounts; encrypted token + metadata           | Yes          |
| `instagram_media`     | Cached eligible posts/Reels for selection                             | Yes          |
| `automation_rules`    | Keyword triggers, templates, gates, enabled state, priority           | Yes          |
| `resources`           | Resource library (title, URL, tracked slug)                           | Yes          |
| `oauth_states`        | Hashed, single-use OAuth state records                                | Yes          |
| `webhook_events`      | Durable incoming event ledger with dedupe key                         | Indirect     |
| `automation_jobs`     | Durable queue with attempts, backoff, locking                         | Indirect     |
| `automation_runs`     | One per handled comment; per-action status and confirmed IDs          | Yes          |
| `usage_records`       | Monthly metric counters used for quotas and analytics                 | Yes          |
| `plans`               | Plan limits (seeded: free, creator, studio)                           | No           |
| `meta_data_requests`  | Deauthorize/data-deletion audit trail (no raw user ids)               | No           |

Design notes:
- UUID primary keys, `timestamptz` everywhere, `created_at`/`updated_at` with trigger maintenance.
- `automation_runs` has `UNIQUE (account_id, comment_id)`: Meta allows exactly one private reply per
  comment, and we prefer at-most-once delivery over duplicate DMs. Re-runs update the same row.
- `webhook_events` has `UNIQUE (account_id, field, comment_id)`.
- `automation_jobs` has `UNIQUE (webhook_event_id)`.
- Usage quotas are enforced atomically with a conditional upsert
  (`... ON CONFLICT ... DO UPDATE ... WHERE quantity + delta <= limit RETURNING`).
- RLS: every tenant table has explicit policies. Helpers `auth.uid()`, `app.is_workspace_member()`,
  `app.is_workspace_admin()`, `app.current_workspace_id()` are `SECURITY DEFINER` with a fixed search
  path. The server uses the service role and additionally scopes queries by workspace; RLS protects
  direct client access with the anon key.
- `profiles` is readable by authenticated users for member display; writes are self-only.

## 6. Tenant isolation strategy (defence in depth)

1. **API:** workspace membership is resolved before every workspace route; services require a
   `workspaceId` argument and never derive it from a row ID alone.
2. **SQL:** every tenant query includes `workspace_id = $n`; IDs are treated as opaque.
3. **RLS:** policies check membership via `workspace_members`, not just "authenticated".
4. **Tests:** two tenants with separate users, asserted against routes/services and against real
   Postgres RLS policies (PGlite). Cross-tenant reads/writes must return 404/403, never data.

## 7. Background processing choice

**Chosen:** a Postgres table (`automation_jobs`) used as a durable queue with `FOR UPDATE SKIP
LOCKED`, exponential backoff, and dead-letter state, processed by an in-process worker.

**Why not Redis/BullMQ:** adds a paid or self-hosted service, another credential, and another failure
domain for an MVP whose throughput is bounded by Meta (750 private replies/hour/account). Postgres
already provides durability and locking. If throughput or fan-out grows, the queue contract can be
swapped for Supabase Queues (`pgmq`) without touching the engine.

**Why not process inline in the webhook handler:** Meta expects a fast 200; retries would duplicate
work; App Review requires reliable behavior. The handler only verifies and persists.

**Idempotency:** event dedupe (unique key), queue dedupe (unique event), run dedupe (unique
account+comment), and per-action claim states. A send is recorded as `unknown` if the process dies
mid-call; it is never blindly retried.

## 8. Meta integration abstraction

`InstagramProvider` (interface) is the only place that knows Graph endpoints:

- `buildAuthorizeUrl`, `exchangeCode`, `exchangeForLongLivedToken`, `refreshToken`
- `getProfile`, `getMedia`, `subscribeWebhooks`
- `replyToComment`, `sendPrivateReply`
- `getUserProfile` (conditional follow status, disabled by default)

`GraphInstagramProvider` implements it using `fetch` with a timeout, typed error parsing, and no token
logging. `FakeInstagramProvider` powers tests. Capabilities are described in a registry
(`integrations/instagram/capabilities.ts`) with status + documentation URL, and are exposed to the UI
so the product can show honest availability.

## 9. Frontend architecture

- React Router routes behind an auth guard; Supabase session in the browser only.
- `ApiClient` interface has two implementations: `HttpApiClient` (Bearer token + REST) and
  `DemoApiClient` (seeded, in-memory, clearly labelled). Both are typed against the same hand-written
  contracts in `lib/api-types.ts`.
- Server state is fetched with small hooks (`useAsync`) and explicit loading/empty/error states; no
  global store is required at this scale.
- Design system: Tailwind tokens, Radix primitives for accessible dialogs/switch/tooltip, focus-visible
  rings, `aria-live` toasts, dark mode via a class on `<html>`.
- Honest UI: demo banner, "test access" badge, capability explanations, delivery states
  (`sent` only after a confirmed API response, `unknown` for interrupted sends).

## 10. Observability and operations

- Structured JSON logs (pino) with request id, workspace id, route, latency, status. Redaction covers
  authorization/cookie headers, tokens, codes, secrets, and webhook bodies.
- `/api/health` (liveness) and `/api/ready` (DB reachable).
- Metrics of interest are queryable from `automation_runs` / `usage_records`; the Analytics page
  exposes them. No separate metrics stack in the MVP.
- Webhook delivery failures, token expiry, and permission errors are visible in the dashboard and
  logged with actionable codes + `fbtrace_id` (when present).

## 11. Scaling path

| Pressure                        | First step                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| Webhook volume                  | Run worker as a separate process; increase concurrency; Postgres queue.  |
| Private-reply rate accounting   | Replace in-process limiter with a DB token bucket per account.          |
| API read load                   | Add covering indexes; cache media lists short-term.                     |
| Multiple regions                | Single writer region for queue correctness; read replicas for analytics. |
| AI features                     | Provider abstraction + budgeted queue; opt-in only.                     |

## 12. Explicit non-goals (MVP)

- Publishing content, ads, hashtag search, product tagging.
- Followers list access or any form of follow verification at comment time.
- Scraping, unofficial endpoints, browser automation, stored Instagram passwords.
- Billing/payments, email delivery, AI-generated sends.
- Multi-region or microservice decomposition.
