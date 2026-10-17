# Security

This document is the security contract for the MVP. Items marked **Implemented** have code and tests
in this repository. Items marked **Operational** require correct configuration by the deployer.

## 1. Assets and trust boundaries

| Asset                                   | Where it lives                         | Protection                                                        |
| --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Instagram User access tokens (60 days)  | Postgres `instagram_accounts`          | AES-256-GCM ciphertext, server-only key, never returned to browser |
| Meta app secret                         | Server env only                        | Never shipped to client; used for OAuth + webhook verification     |
| Supabase service-role key               | Server env only                        | Bypasses RLS; restricted to the API process                        |
| Supabase JWT signing secret             | Server env (optional)                  | Local access-token verification; rotate with Supabase              |
| User access tokens (Supabase session)   | Browser memory/localStorage (SDK)      | Short-lived; sent as `Authorization: Bearer`                       |
| Customer automation data                | Postgres tenant tables                 | RLS + server-side workspace scoping                                |
| Webhook payloads                        | `webhook_events`                       | Minimal fields, retention policy, signature verified               |

Trust boundaries: browser (untrusted) → API (trusted) → Supabase Postgres (trusted, RLS-defended) →
Meta APIs (external, authenticated per call). No customer data crosses between workspaces.

## 2. Authentication and session handling

- **Supabase Auth is the only identity system.** No custom password storage or session issuance.
- The API accepts only `Authorization: Bearer <supabase access token>`.
  - If `SUPABASE_JWT_SECRET` is set, tokens are verified locally with `jose` (HS256, audience
    `authenticated`, issuer `<SUPABASE_URL>/auth/v1`) — constant-time signature check, no network.
  - Otherwise the server calls Supabase `auth.getUser(token)` and uses the returned user id.
  - `alg: none` and symmetric/asymmetric confusion are rejected by pinning algorithms.
- The user id always comes from the verified token, never from a request body or header.
- **CSRF:** the SPA authenticates with bearer tokens, not cookies, so classic CSRF does not apply. The
  only cookie-less state transition is the OAuth callback, protected by a server-issued single-use
  `state`. If cookie sessions are introduced later, add SameSite=Lax + double-submit CSRF tokens.
- Auth endpoints are rate-limited; failed authorization returns 401 without leaking whether an account
  exists.

## 3. Tenant isolation (acceptance criterion)

- [x] RLS enabled on `workspaces`, `workspace_members`, `workspace_invites`, `instagram_accounts`,
      `instagram_media`, `automation_rules`, `resources`, `oauth_states`, `automation_runs`,
      `usage_records`, `webhook_events` (read via run/account joins), `automation_jobs` (no client
      policies — service role only).
- [x] Explicit SELECT/INSERT/UPDATE/DELETE policies using `app.is_workspace_member()` and
      `app.is_workspace_admin()` (`SECURITY DEFINER`, fixed `search_path`, no dynamic SQL).
- [x] API middleware resolves membership before any workspace handler; services require
      `workspaceId` and filter every statement by it.
- [x] Cross-tenant IDs return 404/403 — never data.
- [x] Automated tests: MemoryStore service/route tests **and** real-Postgres RLS tests via PGlite
      (`npm run test:db`) covering read, update, delete and insert attempts across two tenants.
- [x] Service-role key is used only server-side; the browser receives only the anon key.
- [x] `workspace_members` cannot be self-escalated by a member (only owner/admin can write; role
      changes validated).
- **Operational:** confirm `SUPABASE_SERVICE_ROLE_KEY` is never in a Vite/`VITE_` variable or client
  bundle. `npm run build` + a grep in CI is recommended.

## 4. Instagram token handling

- Encryption: AES-256-GCM, 12-byte random IV per token, auth tag stored, key version recorded.
- Key: `TOKEN_ENCRYPTION_KEY` (base64, exactly 32 bytes) from the server environment. Startup fails
  fast if malformed or missing when an account is used.
- AAD binds ciphertext to `instagram_accounts.id`, preventing copy-paste of ciphertext between rows.
- Tokens are decrypted only immediately before an outbound Meta call.
- API responses use a **safe account DTO** (`id`, `username`, `account_type`, `token_expires_at`,
  `status`, `permissions`) — never ciphertext, IV, tag, or token.
- Logs redact `authorization`, `cookie`, `set-cookie`, `x-hub-signature-256`, `access_token`, `code`,
  `client_secret`, `signed_request`, and token-like strings. Request-body logging is disabled for
  OAuth and webhook routes.
- Tests assert that no token material appears in API JSON or logs, and that ciphertext differs from
  plaintext and is tamper-evident.

## 5. OAuth security

- 32-byte random `state`, `base64url`, stored **hashed (SHA-256)** with `expires_at=now+10min`, user id
  and workspace id, and consumed atomically (`DELETE ... RETURNING`) so it is single-use.
- Redirect URI is a server constant (`META_REDIRECT_URI`), not client-supplied. The authorize URL uses
  the same value as the token exchange.
- `state` is never accepted if expired, already used, or bound to a different user/workspace.
- The callback is public by necessity but cannot attach an account without a valid unconsumed state.
- Tokens are exchanged server-side; the app secret never appears in URLs (only in POST body/GET params
  to Meta over HTTPS).
- Permission grants are recorded; missing `instagram_business_manage_comments` marks the account
  `missing_permissions` and disables its rules instead of failing later.

## 6. Webhook security

- **Verification handshake:** `hub.verify_token` compared with `crypto.timingSafeEqual`; wrong token
  → 403.
- **Authenticity:** `X-Hub-Signature-256` computed over the **raw** request body with the app secret;
  timing-safe comparison; missing/invalid signature → 401. Signature verification happens before JSON
  parsing side effects.
- **Replay/duplicate protection:** unique `(account_id, field, comment_id)` and unique job per event;
  duplicate deliveries are ignored. Rate limit applies to the webhook endpoint.
- **Payload validation:** zod parsing of an expected shape; unknown shapes are stored raw (truncated)
  and marked unsupported, never interpreted.
- **Acknowledgement:** fast 200 after persistence. Processing is asynchronous.
- **Data minimization:** only IDs, text, username and media metadata needed for matching are stored;
  raw payload retention is documented (30 days default, cleanup command provided).
- **Deauthorize / data deletion:** `signed_request` is verified (HMAC-SHA256 with app secret,
  base64url, constant-time), then tokens and related data are erased; deletion returns Meta's
  `{url, confirmation_code}` contract. Invalid signatures → 400.
- No webhook body or signature is logged.

## 7. Input validation and API hardening

- Every body/query/param validated with zod; unknown fields rejected on structured writes; length caps
  on all strings (keywords ≤ 50 chars, templates ≤ limits, URLs https-only for resources).
- URL fields reject `javascript:`, `data:` and non-http(s) schemes.
- `express.json({ limit: '256kb' })` and raw-body capture only for webhooks; `helmet` security headers;
  `x-powered-by` disabled.
- CORS: explicit allowlist (`CLIENT_ORIGIN` + optional `CORS_ALLOWED_ORIGINS`), `Authorization` header
  allowed, credentials off. Unknown origins get no CORS headers.
- Rate limits (configurable): auth-adjacent 30/min, mutations 120/min, webhooks 600/min, OAuth start
  20/min. Responses include standard `RateLimit-*` headers.
- Errors return a stable code + safe message. Stack traces only in server logs at debug level. Meta
  `fbtrace_id` is retained for support, raw Meta error messages are sanitized before display.
- Parameterized SQL everywhere; no string interpolation of user input into queries.

## 8. Secrets and configuration

- `.env` is git-ignored; only `.env.example` with placeholders is committed.
- Startup validates environment with zod and refuses:
  - `NODE_ENV=production` with `DEMO_MODE=true`
  - production without real Supabase/Meta credentials
  - a token-encryption key of the wrong length
- The browser build only receives `VITE_*` variables; `server` variables are never bundled.
- Operational: rotate the Meta app secret and Supabase keys on staff/device changes; rotate
  `TOKEN_ENCRYPTION_KEY` only with a planned re-encryption or reconnect flow.
- Least privilege: the API uses the service role because RLS is bypassed by design for background
  work; it never exposes generic SQL or arbitrary table access to clients. Database credentials should
  be scoped to the project and not reused.

## 9. Authorization model

| Role    | Capabilities (MVP)                                                    |
| ------- | --------------------------------------------------------------------- |
| `owner` | Everything: workspace update/delete, members, accounts, rules, billing |
| `admin` | Members (except owner changes), accounts, rules, resources             |
| `member`| Read workspace, create/edit rules and resources; cannot manage members or connections |

Role checks are server-side on every mutation. UI hiding is cosmetic, never the control. Future
permissions can be added without changing the RLS membership helpers.

## 10. Data retention and privacy

| Data                          | Retention                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| Webhook raw payload          | 30 days (cleanup query documented; default 90 in demo)            |
| Automation runs / activity   | 12 months (configurable cleanup)                                  |
| Usage records                | 24 months                                                         |
| OAuth states                 | 10 minutes, deleted on use; expired rows cleaned hourly           |
| Instagram tokens             | Until disconnect/deauthorization or expiry                        |
| Deletion requests            | Audit row without raw Meta ids; retained 24 months                |

- Account disconnect deletes the encrypted token and disables rules. Data deletion removes tokens,
  cached media, rules, runs, resources, and usage for that account/workspace as applicable.
- Workspace deletion (owner-only, name confirmation) cascades all tenant data.
- Privacy notes: comment text and username are stored to run and audit automation. We do not store
  profile pictures, follower graphs, or unrelated personal data. No data is sold or shared with
  third-party AI providers in the MVP.
- Data processing disclosures belong in the operator's privacy policy; this repository documents the
  technical behavior, not legal advice.

## 11. Known limitations and residual risks

1. **Follow verification is unsupported.** No mechanism exists to verify that a commenter follows the
   account. The product marks this explicitly and does not accept "I followed" clicks as proof.
2. **At-most-once sends.** A process crash between Meta's response and our DB commit can produce an
   `unknown` status. We prefer this to duplicate DMs (Meta permits only one private reply per
   comment). Operators can review unknowns manually.
3. **In-process rate limiter.** Per-account limits are accurate for a single worker process; horizontal
   scaling needs a shared token bucket (documented).
4. **Meta error messages** may contain user content. We display sanitized codes/messages and keep full
   details only in server logs with redaction.
5. **Demo mode** uses browser-local sample data (never the API or Instagram). It is visibly labelled and must never be enabled in a
   customer-facing production deployment.
6. **RLS tests run against PGlite**, a real Postgres build, but not against the hosted Supabase
   instance. Re-run `supabase/tests` against staging before launch.
7. No formal third-party penetration test has been performed. This is an MVP hardening baseline.

## 12. Security test matrix

| # | Test                                                        | Layer            |
| - | ----------------------------------------------------------- | ---------------- |
| 1 | Cross-tenant read/update/delete denied                      | RLS + API tests  |
| 2 | Member cannot escalate role / access other workspace        | API + RLS        |
| 3 | Token not present in API response or serialized logs        | Unit             |
| 4 | Ciphertext tamper detection                                 | Unit             |
| 5 | Invalid OAuth state, expired state, replay                  | Unit             |
| 6 | Missing/invalid webhook signature rejected                  | Unit + route     |
| 7 | Wrong verify token rejected; challenge echoed on success    | Unit + route     |
| 8 | Duplicate webhook delivery ignored                          | Engine + DB      |
| 9 | Quota conditional upsert cannot exceed limit under retries  | DB + unit        |
| 10| Missing permission produces actionable, non-retryable error | Unit             |
| 11| Strict follow gate cannot be enabled                        | Unit + API       |
| 12| Resource URL scheme validation                              | Unit             |
| 13| 7-day private-reply window enforced locally                 | Unit             |
| 14| Rate limit headers returned                                 | Route            |
