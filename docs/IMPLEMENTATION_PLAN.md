# Implementation Plan and Acceptance Criteria

**Status:** Phases 0–8 implemented and tested locally; see `docs/LIMITATIONS.md` for what is verified
locally vs. what requires Meta credentials/approval.
**Last updated:** 2026-10-17

The repository was empty at the start (single-line README), so this is a greenfield scaffold. The plan
is intentionally phased: each phase produces something testable, and the final report separates
locally-verified behavior from behavior that depends on external approvals.

## Phase 0 — Research and feasibility (required first)

**Deliverables:** `docs/META_API_FEASIBILITY.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
`docs/IMPLEMENTATION_PLAN.md`.

**Acceptance criteria**
- [x] Official Meta documentation inspected for login flows, eligibility, permissions, webhooks,
      public/private replies, OAuth lifecycle, App Review, limits, errors, and policy constraints.
- [x] Every capability classified VERIFIED / CONDITIONAL / UNVERIFIED / UNSUPPORTED with source URLs.
- [x] Follow-gating investigated; conclusion recorded: unsupported at comment time, conditional after
      the user DMs. No fake verification built.
- [x] Architecture, tenant model, queue rationale, and security baseline documented before coding.

## Phase 1 — Repository & environment inspection

- [x] Confirmed empty repository, Node 22 available, no psql/Supabase CLI/Docker in the sandbox.
- [x] Chose a test strategy that works without hosted services: PGlite (real Postgres in WASM) for
      schema/RLS tests; memory store for API tests; live Meta tests opt-in only.
- [x] Preserved the existing README (replaced with a real project README after scaffolding).

## Phase 2 — Foundation

**Deliverables:** npm workspaces (`client`, `server`), TypeScript strict, Tailwind, ESLint/Prettier,
env validation, structured logging, error model, migration runner, test runners.

**Acceptance criteria**
- [x] `npm run typecheck`, `npm run lint`, `npm run build` succeed.
- [x] Config fails fast with actionable messages when required secrets are absent (outside demo).
- [x] `GET /api/health` and `GET /api/ready` respond.
- [x] Root scripts exist for dev, build, test, lint, typecheck, db migration, format.

## Phase 3 — Auth and multi-tenancy

**Deliverables:** migration `0001` (schema), `0002` (RLS), `0003` (functions/seed); Supabase Auth
verification; workspaces/members/invites APIs; profile bootstrap.

**Acceptance criteria**
- [x] Every tenant table has RLS enabled and explicit policies.
- [x] Cross-tenant SELECT/INSERT/UPDATE/DELETE denied (tested against real Postgres via PGlite).
- [x] API rejects non-members and unauthenticated requests; user id comes from the verified JWT.
- [x] Roles `owner`/`admin`/`member` enforced on mutations; member role escalation blocked.
- [x] Tests use two users + two workspaces and assert no data leaks.

## Phase 4 — Meta integration

**Deliverables:** provider interface + Graph implementation, OAuth start/callback, token encryption,
token refresh, webhook subscription, media listing, disconnect, deauthorize/data-deletion callbacks,
capability registry.

**Acceptance criteria**
- [x] Authorize URL, code exchange, long-lived exchange, refresh, and profile fetch match official docs.
- [x] State is random, hashed at rest, single-use, expiring, and bound to user+workspace.
- [x] Tokens encrypted at rest; no token material in responses or logs.
- [x] Missing scopes surface an actionable permission error and disable unsafe execution.
- [x] Fake provider powers tests; live provider is isolated behind the interface.
- [ ] **Requires operator:** real Meta app credentials, redirect URI, App Review, app Live, HTTPS host.
  (Code path exists; cannot be exercised in this sandbox.)

## Phase 5 — Webhook and automation engine

**Deliverables:** verification GET, signed POST, normalization, durable event ledger, Postgres queue,
worker with backoff, matcher, template renderer, execution engine, rate budget, idempotency guards.

**Acceptance criteria**
- [x] Invalid signature/verify token rejected.
- [x] Duplicate delivery ignored (unique keys + tests).
- [x] Webhook handler performs no Meta calls and acks after persistence.
- [x] Keyword matching is case-insensitive, multi-keyword, phrase-aware, and test-covered.
- [x] Only one automation handles a comment; multiple matches recorded as superseded.
- [x] 7-day private-reply window enforced locally.
- [x] Transient vs permanent Meta errors classified; retries bounded with backoff; permanent errors
      not retried.
- [x] Successful delivery only recorded when Meta returns a message/comment id.
- [x] Disabled rules never execute.

## Phase 6 — Dashboard

**Deliverables:** auth screens, app shell, Overview, Accounts (+ connect flow), Automations list,
builder, Resources, Activity, Analytics, Settings, Usage; accessible components; light/dark; demo mode.

**Acceptance criteria**
- [x] Responsive, keyboard-accessible, labelled controls; focus rings; dialogs trap focus (Radix).
- [x] Loading, empty, error, and success states on every data screen.
- [x] Automation builder validates keywords, templates, resource URL, account/media, follow gate.
- [x] Test mode is explicitly labelled "no message sent".
- [x] Demo data is visually labelled and never presented as a real API result.
- [x] Follow-gate verification is disabled with an explanation and docs link.
- [x] Client tests cover loading/empty/error/success rendering.

## Phase 7 — Analytics and quotas

**Deliverables:** usage meter, atomic quota function, analytics endpoints, activity logs, resource
click tracking.

**Acceptance criteria**
- [x] Track comments received, events processed, matches, public/private attempts and confirmations,
      failures, duplicates ignored, resource clicks, monthly usage.
- [x] Quota enforcement is atomic and cannot be exceeded by concurrent/retried work (DB conditional
      upsert + tests).
- [x] Plan limits are displayed; no "unlimited" claims.
- [x] Click tracking explicitly does not imply follow verification.

## Phase 8 — Polish, verification, documentation

- [x] README, SETUP, DEPLOYMENT/COSTS, LIMITATIONS, API reference.
- [x] Typecheck, lint, unit/integration tests, DB RLS tests, production builds run and fixed.
- [x] Secret scan of the repo; `.env` ignored; examples contain no real credentials.
- [x] Final report lists what works locally, what needs Meta approval, and what is unsupported.

## Definition-of-done mapping

| Definition-of-done item                     | Evidence                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Application builds                          | `npm run build` (client + server)                                     |
| Authentication works                        | Supabase Auth (browser) + verified JWT on API; demo auth for preview  |
| Workspace isolation tested                  | `server/test/db/tenant-isolation.test.ts`, `server/test/api/app.test.ts` |
| Migrations reproducible                     | `supabase/migrations/*.sql`, `npm run db:migrate`, PGlite harness      |
| Dashboard manages rules                     | Automations list + builder + CRUD API                                 |
| Meta OAuth/webhooks follow current docs     | Provider + webhook implementation, feasibility doc with sources       |
| Keyword matching + dedupe tested            | `server/test/unit/matcher.test.ts`, `server/test/api/webhooks.test.ts`, `engine.test.ts` |
| Comment actions with error handling         | Public/private reply with confirmed IDs, typed errors, retry policy   |
| Follow verification only if verified        | Not verified → disabled + documented                                  |
| Real vs mock distinguished                  | Fake provider only in tests; demo mode banner; LIMITATIONS doc        |
| Docs complete, no secrets                   | `/docs`, `.env.example`, secret scan                                   |
| Final report                                | `docs/LIMITATIONS.md` + project README summary                        |

## Commands

```bash
npm install
cp .env.example .env            # fill Supabase/Meta values for real mode
npm test                        # server unit/API + DB/RLS (PGlite) + client UI
npm run test:server             # server unit + API integration only
npm run test:db                 # schema + RLS tests on real Postgres (PGlite)
npm run test:live               # opt-in real Meta checks (skipped without credentials)
npm run db:migrate              # apply migrations to DATABASE_URL
npm run typecheck && npm run lint && npm run build
npm run dev                     # API :3001 and client :5173 (client demo mode by default)
```
