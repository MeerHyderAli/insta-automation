# HTTP API Reference

**Base URL:** `https://<api-host>` (local: `http://localhost:3001`)
**Version:** 1 (unversioned path prefix; pin `META_GRAPH_VERSION` separately)
**Last updated:** 2026-10-17

This is a pragmatic reference for the implemented routes. All tenant routes require a Supabase access
token and workspace membership. The API never returns Instagram access tokens or encrypted token
fields.

## Authentication

```http
Authorization: Bearer <supabase-access-token>
```

- The API verifies the JWT signature (JWKS when `SUPABASE_URL` is set, otherwise an optional HS256
  secret), issuer/audience, and expiry.
- The user id comes only from the verified token. A client-supplied user id is ignored.
- Mutating and tenant routes resolve `workspace_members` for the `:workspaceId` path parameter. A
  non-member receives `404 NOT_FOUND` (not `403`) to avoid confirming that a workspace exists.
- Roles: `owner > admin > member`. Member management and workspace deletion require `owner`;
  connecting accounts and most bulk mutations require `admin` or `owner`.

## Errors

Every error uses the same envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Add at least one keyword.",
    "details": ["optional", "array"]
  },
  "requestId": "b1c2…"
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid body/params/query |
| 401 | `UNAUTHENTICATED` | Missing/invalid token |
| 401 | `WEBHOOK_SIGNATURE_INVALID` | Bad `X-Hub-Signature-256` |
| 403 | `FORBIDDEN` | Role or ownership failure |
| 403 | `WEBHOOK_VERIFY_FAILED` | Wrong webhook verify token |
| 403 | `PERMISSION_MISSING` | Instagram scopes missing |
| 404 | `NOT_FOUND` | Unknown resource, or hidden tenant |
| 409 | `CONFLICT` | Duplicate rule name/member; reconnect required |
| 409 | `RECONNECT_REQUIRED` | Instagram token/account unusable |
| 422 | `CAPABILITY_UNAVAILABLE` | Requested unsupported Meta capability (follow verify) |
| 429 | `RATE_LIMITED` / `QUOTA_EXCEEDED` / `META_RATE_LIMITED` | Local/plan/Meta limit |
| 502 | `META_API_ERROR` | Instagram rejected the outbound call |
| 503 | `NOT_CONFIGURED` | Meta/Supabase credentials missing |

Rate limits apply to auth/limit (`429`), OAuth, webhook and mutation scopes. `Retry-After` is exposed
when available. Responses include `x-request-id`; quote it in support requests.

## Public routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness, no DB dependency |
| GET | `/api/ready` | Readiness; checks the database, `503` when unavailable |
| GET | `/api/config` | Public non-secret config/capabilities (demo flag, Meta configured, follow capability) |
| GET | `/api/webhooks/instagram` | Meta verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| POST | `/api/webhooks/instagram` | Meta event delivery (HMAC required) |
| POST | `/api/webhooks/instagram/deauthorize` | Meta deauthorize signed request |
| POST | `/api/webhooks/instagram/data-deletion` | Meta data-deletion signed request |
| GET | `/api/webhooks/instagram/data-deletion/status?code=…` | Deletion status |
| GET | `/api/integrations/instagram/callback` | OAuth callback; redirects to the client with `instagram=connected|error` |
| GET | `/r/:slug` | Tracked resource link; `302` to the HTTPS destination |

Webhook details, sample payloads and signature examples are in
[`docs/SETUP.md`](SETUP.md#7-webhook-testing-without-meta).

## Profile and workspaces

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/api/me` | any | Upserts profile; returns `{user, profile, workspaces}` |
| PATCH | `/api/me` | any | `{fullName?: string \| null}` → `{profile}` |
| GET | `/api/workspaces` | any | Workspaces the user belongs to |
| POST | `/api/workspaces` | any | `{name, timezone?}` → `201 {workspace}` |
| GET | `/api/workspaces/:workspaceId` | member | `{workspace, counts}` |
| PATCH | `/api/workspaces/:workspaceId` | owner/admin | `{name?, timezone?}` → `{workspace}` |
| DELETE | `/api/workspaces/:workspaceId` | owner | `{confirmName}` → `204`; cascades tenant data |
| GET | `/api/workspaces/:workspaceId/members` | member | `{members}` |
| POST | `/api/workspaces/:workspaceId/members` | owner/admin | `{email, role: 'admin'\|'member'}` → `201 {member}` |
| PATCH | `/api/workspaces/:workspaceId/members/:userId` | owner | `{role}` → `{ok: true}`; owner role cannot change |
| DELETE | `/api/workspaces/:workspaceId/members/:userId` | owner/admin | `204`; owner/self removal blocked |

`timezone` is an IANA name (for example `Asia/Kolkata`) and is validated server-side.
`confirmName` must exactly match the workspace name.

## Instagram accounts and OAuth

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/api/workspaces/:workspaceId/accounts` | member | `{accounts}`; token fields are never serialized |
| POST | `/api/workspaces/:workspaceId/oauth/start` | owner/admin | `{authorizeUrl}` for Instagram Login |
| GET | `/api/workspaces/:workspaceId/accounts/:accountId/media` | member | Cached media `{media}` |
| POST | `/api/workspaces/:workspaceId/accounts/:accountId/media/sync` | owner/admin | Refreshes media from Graph → `{media}` |
| POST | `/api/workspaces/:workspaceId/accounts/:accountId/webhook-subscribe` | owner/admin | Calls `/me/subscribed_apps`, stores confirmed timestamp → `{account}` |
| POST | `/api/workspaces/:workspaceId/accounts/:accountId/refresh-token` | owner/admin | Refreshes a long-lived token → `{account}` |
| POST | `/api/workspaces/:workspaceId/accounts/:accountId/disconnect` | owner/admin | Revokes local token material, status `disconnected` → `204` |
| DELETE | `/api/workspaces/:workspaceId/accounts/:accountId` | owner/admin | `{confirmUsername}` → `204`; removes account data |

Account object (safe fields): `id`, `workspaceId`, `igUserId`, `username`, `accountType`, `scopes`,
`tokenExpiresAt`, `tokenExpiresInDays`, `status`, `lastErrorCode`, `webhookSubscribed`,
`permissionsOk`, `missingPermissions`. `status` is `connected`, `needs_reconnect`,
`missing_permissions`, or `disconnected`.

OAuth: the start endpoint returns an official `https://www.instagram.com/oauth/authorize` URL with a
single-use state. Meta redirects the browser to the API callback; the API exchanges the code, obtains a
60-day token, encrypts it, stores the account, and redirects to the client. Errors are surfaced as
`instagram=error&reason=…`; authorization codes are never logged.

## Automation rules

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/api/workspaces/:workspaceId/rules` | member | `{rules}` |
| GET | `/api/workspaces/:workspaceId/rules/:ruleId` | member | `{rule}` |
| POST | `/api/workspaces/:workspaceId/rules` | member | Create → `201 {rule, warnings}` |
| PATCH | `/api/workspaces/:workspaceId/rules/:ruleId` | member | Partial update → `{rule, warnings}` |
| POST | `/api/workspaces/:workspaceId/rules/:ruleId/test` | member | Render/test only; **sends nothing** |
| DELETE | `/api/workspaces/:workspaceId/rules/:ruleId` | member | `204` |

Create body:

```json
{
  "name": "Guide requests",
  "accountId": "uuid",
  "mediaId": "1789…",
  "keywords": ["API", "GUIDE", "FREE"],
  "publicReplyTemplate": "Sent you a DM, {{username}}!",
  "privateReplyTemplate": "Here is the guide: {{resource_url}}",
  "resourceId": "uuid-or-null",
  "followGate": "off",
  "priority": 100,
  "enabled": true
}
```

- `keywords`: 1–20, each 1–50 chars, trim/dedupe case-insensitively; whole-word, case-insensitive
  matching, multiple keywords per comment allowed.
- `publicReplyTemplate` max 2000 chars; `privateReplyTemplate` max 900. Both optional, but at least one
  reply template is required.
- Placeholders: `{{username}}`, `{{keyword}}`, `{{resource_url}}`, `{{resource_title}}`,
  `{{account_username}}`, `{{follow_instructions}}`. Unknown/ unclosed placeholders are rejected.
- `mediaId` is a **synced media id** from the account; `null` means all posts/Reels.
- `followGate: "verify"` → `422 CAPABILITY_UNAVAILABLE`; use `"off"` or `"instruction"`.
- `priority`: 1–1000, lower wins after media specificity. `enabled` controls execution.
- `warnings` are non-blocking (for example, enabling a rule before webhook delivery is confirmed).

Test body:

```json
{ "commentText": "API please", "mediaId": "optional-media-id" }
```

Response:

```json
{
  "matched": true,
  "matchedKeyword": "API",
  "publicReply": { "text": "Sent you a DM, reader!", "length": 20, "limit": 2000, "errors": [] },
  "privateReply": { "text": "Here is the guide: https://…", "length": 45, "limit": 900, "errors": [] },
  "notes": ["No message was sent."]
}
```

## Resources

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/api/workspaces/:workspaceId/resources` | member | `{resources}` with `trackedUrl` |
| POST | `/api/workspaces/:workspaceId/resources` | member | `{title, description?, url}` → `201 {resource}` |
| PATCH | `/api/workspaces/:workspaceId/resources/:resourceId` | member | Partial update → `{resource}` |
| DELETE | `/api/workspaces/:workspaceId/resources/:resourceId` | member | `204` |

`url` must be `https://`, with no embedded credentials. The server generates a short `slug` and
returns `trackedUrl = API_PUBLIC_URL/r/<slug>`. Clicks increment `clickCount` and are explicitly **not**
follow verification.

## Activity and analytics

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/api/workspaces/:workspaceId/runs` | member | `{runs, pagination}` |
| GET | `/api/workspaces/:workspaceId/runs/:runId` | member | `{run, events, webhook}` |
| GET | `/api/workspaces/:workspaceId/analytics?days=1..90` | member | `{analytics, metaLimits}` |
| GET | `/api/workspaces/:workspaceId/usage` | member | `{plan, periodStart, metrics, counts, metaLimits, notes}` |

Run filters: `limit` (1–100, default 50), `offset`, `status`, `accountId`, `ruleId`.
Pagination: `{total, limit, offset, hasMore}`.

Run status: `queued`, `processing`, `completed`, `partial`, `failed`, `skipped`.
Reply status: `skipped`, `pending`, `sending`, `sent`, `failed`, `unknown`.
`unknown` means the request may have reached Instagram but no confirmation was received; it is **never
retried automatically** for private replies.

Analytics object includes `commentsReceived`, `eventsProcessed`, `keywordMatches`,
`publicRepliesAttempted`, `publicRepliesSent`, `privateRepliesAttempted`, `privateRepliesSent`,
`failures`, `duplicatesIgnored`, `skipped`, `resourceClicks`, and a daily series.

## Plans and quotas

Seeded plans:

| Plan | Accounts | Rules | Resources | Members | Private replies/month | Comments/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| free | 1 | 3 | 10 | 1 | 100 | 500 |
| creator | 2 | 20 | 50 | 3 | 2,000 | 5,000 |
| studio | 5 | 100 | 250 | 10 | 10,000 | 25,000 |

Quotas are enforced atomically in Postgres (`app.increment_usage`); concurrent requests cannot exceed
the limit. A `429 QUOTA_EXCEEDED` response means the action was not performed. Meta's own limits still
apply (private replies: 750/hour/account; see the feasibility doc).

## CORS and content types

- Allowed origins: `CLIENT_ORIGIN` plus `CORS_ORIGINS`; no wildcard.
- JSON requests: `Content-Type: application/json`; body limit 1 MB (webhook/JSON), URL-encoded limit
  32 KB.
- Webhooks must send the **raw** JSON body and a valid `X-Hub-Signature-256`.
- No cookie authentication is used, so CSRF tokens are not required for the browser API; bearer tokens
  are never stored in cookies. Supabase session storage is in the browser and is subject to XSS
  protection (CSP/helmet, dependency hygiene).
