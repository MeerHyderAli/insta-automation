# Meta / Instagram API Feasibility Study

**Status:** Phase Zero complete — implementation decisions locked
**Research date:** 2026-10-17
**Primary sources:** Meta's official developer documentation only (`developers.facebook.com`). Third-party
material was used solely to locate official pages, never as evidence of a capability.

This document records what the official Instagram Platform APIs permit **today**, what they do not
permit, and the consequences for this product. Every capability below has an explicit verification
status. The implementation must never claim a capability beyond what is recorded here.

Status legend

| Status        | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| `VERIFIED`    | Confirmed by current official Meta documentation (source URL recorded).                   |
| `CONDITIONAL` | Available only after permissions, account eligibility, App Review, or another gate.       |
| `UNVERIFIED`  | Insufficient official evidence, or documentation is ambiguous. Not relied on in the MVP.  |
| `UNSUPPORTED` | Officially unavailable for our intended use. No workaround is implemented.                |

---

## 1. Decision summary

| Decision                              | Choice                                                             | Why                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| API configuration                     | **Instagram API with Instagram Login**                             | Supports professional accounts without requiring a linked Facebook Page. Comment moderation, private replies and messaging are supported. |
| Identity/permission family            | `instagram_business_*`                                             | This is the permission family used by the Instagram Login configuration. Tokens are not interchangeable with Facebook Login tokens.     |
| Host                                  | `graph.instagram.com` (OAuth endpoints: `instagram.com`, `api.instagram.com`) | Documented base URLs for this configuration.                                                                                            |
| Login flow                            | Business Login for Instagram (custom OAuth, authorization `code`)   | Official, supports state, returns Instagram User access token.                                                                            |
| Pinned API version                    | `v25.0` by default, env-overridable                                | `v25.0` is used in current Instagram Platform docs and is supported until 2028-07-29. Latest Graph API is `v26.0` (2026-07-29); upgrade is a config change after review. |
| Webhooks                              | `comments`, optionally `live_comments`                             | Documented and required for comment-triggered automation. `messages` only if the post-DM follow check is enabled.                       |
| Public reply                          | `POST /<IG_COMMENT_ID>/replies`                                    | Documented, permitted, with limits.                                                                                                      |
| Private reply                         | `POST /<IG_USER_ID>/messages` with `recipient.comment_id`           | Documented, one message per comment, within 7 days.                                                                                      |
| Strict follow gating at comment time  | **NOT IMPLEMENTED — UNSUPPORTED**                                  | No official endpoint returns follower status for an arbitrary commenter.                                                                 |
| Later follow check after the user DMs | Designed behind a feature flag — **CONDITIONAL**                    | User Profile API exposes `is_user_follow_business`, but only with messaging consent.                                                     |
| Deployment shape                      | Single Node service + in-process worker + Postgres queue           | Webhooks need a continuously reachable endpoint; no Redis or extra services required for MVP scale.                                     |

**Headline finding:** the core product (keyword-triggered public replies and one private reply per
comment) is feasible with official APIs. **Strict "follow before we send the resource" gating is not
feasible for commenters**, and this product does not fake it.

---

## 2. API products and login flows

Meta documents two Instagram API configurations:

| Component         | Instagram Login                                             | Facebook Login                                                    |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Login             | Business Login for Instagram (Instagram credentials)        | Facebook Login for Business                                       |
| API host          | `graph.instagram.com`                                       | `graph.facebook.com`                                              |
| Token             | Instagram User access token                                 | Facebook User / Page access token                                 |
| Facebook Page     | Not required                                                | Required, linked to the Instagram account                         |
| Permissions       | `instagram_business_*` family                               | `instagram_*` family + Page permissions                           |
| Comments          | Supported                                                   | Supported                                                         |
| Messaging         | Supported by Instagram Platform messaging APIs              | Supported through Messenger Platform                              |
| Hashtag search    | Not supported                                               | Supported                                                         |
| Product tagging   | Not supported                                               | Supported                                                         |

**Choice:** Instagram Login. Our customers are creators and businesses who may not have a linked
Facebook Page; requiring one would exclude a large segment. The trade-off is no hashtag search and no
product tagging — neither is required.

Sources:
- <https://developers.facebook.com/documentation/instagram-platform/overview>
- <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login>

---

## 3. Account eligibility

| Requirement                         | Evidence                                                                                                                        | Status      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Instagram **professional account**  | "To use the APIs, your app users must have an Instagram professional account ... can represent a business or creator."           | `VERIFIED`  |
| **Creator** accounts supported      | Overview lists business **and creator** accounts; `/me` `account_type` returns `Business` or `Media_Creator`.                     | `VERIFIED`  |
| Personal accounts                   | Not a professional account; not supported by this API.                                                                           | `UNSUPPORTED` |
| Account must be **public** for comment webhooks | Webhooks doc: the professional account that owns the media "must be public to receive notifications for comments or @mentions." | `VERIFIED`  |
| Account must be able to log in to Instagram and grant scopes | Business Login flow.                                                                                              | `VERIFIED`  |
| Messaging enabled on the account    | Required only for DM features; not required for comment replies.                                                                 | `CONDITIONAL` |

Consequence: the connect screen warns that the account must be public and professional. The
automation engine records a `account_not_public` / no-webhook-events condition as an observable
health signal, but it cannot itself force the account public.

Source: <https://developers.facebook.com/documentation/instagram-platform/overview>,
<https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started>

---

## 4. Permissions and access levels

### 4.1 Required permissions for this product

| Capability                          | Permissions (Instagram Login)                                                    | Access level                                     | Status      |
| ----------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | ----------- |
| Read profile, media list            | `instagram_business_basic`                                                       | Standard for owned accounts; Advanced for others | `VERIFIED`  |
| Receive `comments` / `live_comments`| `instagram_business_basic`, `instagram_business_manage_comments`                 | Advanced (plus app Live)                          | `VERIFIED`  |
| Public reply to comment             | `instagram_business_basic`, `instagram_business_manage_comments`                 | Advanced for third-party accounts                 | `VERIFIED`  |
| Private reply to commenter          | `instagram_business_basic`, `instagram_business_manage_comments`                 | Advanced for third-party accounts                 | `VERIFIED`  |
| Post-DM follow status (optional)    | plus `instagram_business_manage_messages`                                        | Advanced; user consent required                   | `CONDITIONAL` |
| Comment insights                    | `instagram_business_manage_insights` — **not requested**                          | n/a                                              | Not in scope |

**Access levels:**
- **Standard Access** — the default. Only usable by people with a role on the app (development/testing)
  and for accounts the developer owns/manages.
- **Advanced Access** — required to serve Instagram professional accounts you do not own or manage.
  Requires **App Review** and **Business Verification**.

Source: <https://developers.facebook.com/documentation/instagram-platform/overview#access-levels>

### 4.2 App Review and business verification

| Item                                   | Detail                                                                                                    | Status        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| App type                               | Must be a **Business** app to add the Instagram product.                                                   | `VERIFIED`    |
| Business Verification                  | Required before publishing / for Advanced Access.                                                          | `CONDITIONAL` |
| App Review                             | Required for Advanced Access; screen recordings and use-case description required.                         | `CONDITIONAL` |
| App Live mode                          | Required for Meta to deliver webhook notifications.                                                        | `VERIFIED`    |
| Deauthorize + Data Deletion callbacks  | Registered in App Dashboard → Instagram → Business login settings. Required for a production integration.   | `VERIFIED`    |

The MVP therefore works end-to-end **only for accounts that hold a role on the Meta app** until App
Review is granted. This is a product launch dependency, not a code defect.

Sources:
<https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app>,
<https://developers.facebook.com/documentation/instagram-platform/webhooks>

---

## 5. OAuth lifecycle (Business Login for Instagram)

| Step                  | Endpoint / value                                                                                     | Detail                                                                                  | Status     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Authorize             | `https://www.instagram.com/oauth/authorize`                                                          | `client_id` = Instagram App ID, `redirect_uri`, `response_type=code`, `scope` (comma separated), optional `state`. | `VERIFIED` |
| Authorization code    | Valid **1 hour**, single use. Redirect appends `#_` which must be stripped.                           | `VERIFIED` |
| Exchange code         | `POST https://api.instagram.com/oauth/access_token` (form data)                                      | `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`. Returns `data[0].access_token`, `user_id`, `permissions`. | `VERIFIED` |
| Short-lived token     | **1 hour**                                                                                           | Instagram User access token.                                                            | `VERIFIED` |
| Long-lived exchange   | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…`          | **Server-side only.** Valid **60 days**.                                                | `VERIFIED` |
| Refresh               | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`                   | Token must be ≥24 h old, unexpired, and app must still hold `instagram_business_basic`. Refreshes for another 60 days. | `VERIFIED` |
| Revocation            | Users revoke in Instagram settings; Meta notifies the registered **Deauthorize callback**.           | No documented Instagram-Login token-revocation endpoint was found.                      | `UNVERIFIED` |
| Disconnect (our side) | Delete local encrypted token, mark account disconnected; optionally attempt Meta-side revoke if one is documented later. | Local behavior is `VERIFIED`; Meta-side revoke is `UNVERIFIED`. | `CONDITIONAL` |
| Data deletion         | Meta POSTs `signed_request` to the registered URL; app returns `{url, confirmation_code}`.           | Signed with the Instagram app secret; HMAC-SHA256.                                       | `VERIFIED` |

Implementation consequences:
- OAuth `state` is generated server-side, stored **hashed**, single-use, 10-minute expiry, bound to
  `{workspace, user}`. The callback is a browser redirect, so no bearer token is available there.
- The OAuth callback must never be blocked on App Review; missing scopes are recorded and shown as an
  actionable permission error.
- Long-lived tokens are refreshed by a scheduled job before the 60-day expiry. Refresh failure marks
  the account **needs_reconnect**, and automations for that account stop rather than failing silently.

Sources: <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login>

---

## 6. Webhooks

| Item                     | Detail                                                                                                                         | Status      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Verification handshake   | `GET` with `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`. Must compare the token and echo the challenge.            | `VERIFIED`  |
| Payload authenticity     | `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(raw body, app secret)>`. Compare timing-safe.                                    | `VERIFIED`  |
| Ack behavior             | Respond `200 OK` quickly. Meta retries failed deliveries immediately, then with decreasing frequency for up to **36 hours**.      | `VERIFIED`  |
| Batching                 | Batches up to 1000 updates; batching not guaranteed. Endpoint must handle individual events.                                     | `VERIFIED`  |
| Deduplication            | Meta explicitly instructs servers to deduplicate on retries.                                                                    | `VERIFIED`  |
| Fields                   | `comments`, `live_comments` for this product. `messages` only for optional DM follow check.                                      | `VERIFIED`  |
| Subscription API         | `POST /me/subscribed_apps?subscribed_fields=comments,live_comments` with the Instagram User token.                                | `VERIFIED`  |
| Object / entry shape     | `object: "instagram"`, `entry[].id` = professional account ID, `entry[].time`, and comments with `value.id` (comment ID), `value.from.id` (IGSID), `value.from.username`, `value.text`, `value.media.id`, `value.media.media_product_type`. | `VERIFIED`  |
| Comment on a comment     | Facebook-Login payload includes `parent_id`; for Business Login, treat `parent_id`/replies defensively and only act on top-level comments. Public replies to replies are not a distinct capability. | `CONDITIONAL` |
| Account-level field customization | Not supported: subscribing to any field delivers all subscribed fields.                                                    | `VERIFIED`  |
| Live comments            | Notifications only during a live broadcast; private replies only during the broadcast.                                          | `VERIFIED`  |

Architecture consequence: the webhook route verifies the signature over the **raw body**, persists the
event idempotently, enqueues work, and returns `200` immediately. No Meta API call, AI call, or
delivery action happens inside the request. Duplicate deliveries are ignored by a unique event key.

Sources: <https://developers.facebook.com/documentation/instagram-platform/webhooks>,
<https://developers.facebook.com/documentation/instagram-platform/comment-moderation>

---

## 7. Public comment replies

| Item                   | Detail                                                                                                                  | Status      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| Endpoint               | `POST /<IG_COMMENT_ID>/replies` with `message`.                                                                          | `VERIFIED`  |
| Permissions            | `instagram_business_basic`, `instagram_business_manage_comments`.                                                        | `VERIFIED`  |
| Success response       | `{ "id": "<new comment id>" }`.                                                                                          | `VERIFIED`  |
| Only top-level comments| "You can only reply to top-level comments; replies to a reply will be added to the top-level comment."                    | `VERIFIED`  |
| Hidden comments        | Cannot reply to hidden comments.                                                                                         | `VERIFIED`  |
| Live comments          | Cannot publicly reply to comments on a live video; use private reply instead.                                            | `VERIFIED`  |
| Message length         | Instagram comment character limit is 2,200. We enforce a conservative 2,200-char validation and warn above 1,000.          | `CONDITIONAL` |
| Batch endpoint         | Meta documents batching replies. Not used: per-comment confirmation and idempotency matter more than throughput here.     | `VERIFIED` (not used) |

**Important:** the response confirms the reply comment was created. It is the only proof we accept
that a public reply was delivered. We never mark a reply "delivered" optimistically.

Source: <https://developers.facebook.com/documentation/instagram-platform/comment-moderation>

---

## 8. Private replies and messaging windows

| Item                          | Detail                                                                                                                                          | Status      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Endpoint                      | `POST /<IG_USER_ID>/messages` with `recipient.comment_id` and `message.text`.                                                                    | `VERIFIED`  |
| Permissions                   | `instagram_business_basic`, `instagram_business_manage_comments`. (Messaging permission is not required for the private reply itself.)            | `VERIFIED`  |
| Window                        | Within **7 days** of the comment.                                                                                                               | `VERIFIED`  |
| Live                          | Only during the live broadcast; not after it ends.                                                                                              | `VERIFIED`  |
| One message per comment       | "Only one message can be sent to the commenter." Further attempts are rejected by Meta.                                                          | `VERIFIED`  |
| Follow-ups                    | Only if the recipient responds, within **24 hours** of that response.                                                                           | `VERIFIED`  |
| Where it lands                | Inbox if the person follows the account; **Requests** if they do not.                                                                           | `VERIFIED`  |
| Message content               | Text-only in our implementation. No media is sent.                                                                                              | `VERIFIED`  |
| Success response              | `{ "recipient_id": "<IGSID>", "message_id": "<id>" }`.                                                                                           | `VERIFIED`  |
| Rate limit                    | **750 / hour / professional account** for post & Reel comments; 100/s for Live comments; Send API 100/s text.                                   | `VERIFIED`  |
| Automated conversations       | Automated experiences must disclose automation where required by law and follow the messaging policy; no unsolicited promotional DMs.            | `VERIFIED`  |

Design consequences:
- **Only one automation may act on a comment.** If several rules match, the highest-priority rule wins
  and the others are recorded as skipped/superseded. This prevents guaranteed 1-reply-limit failures.
- The engine enforces the 7-day window locally before calling Meta, and refuses to attempt after it.
- The private reply is idempotent **at-most-once**: the database claims the send before the API call.
  A crash mid-call leaves an `unknown` state visible to the user instead of risking a duplicate send.
- Per-account hourly budget is checked from `automation_runs` (sent in the last hour) with a safety
  margin below 750.

Sources: <https://developers.facebook.com/documentation/instagram-platform/private-replies>,
<https://developers.facebook.com/documentation/instagram-platform/overview#rate-limiting>

---

## 9. Follow-status verification (critical requirement)

**Question:** can we determine, for an arbitrary commenter, whether they follow the connected
professional account?

**Answer: no, not at comment time.**

Evidence:
1. The only documented field that reports this relationship is
   `is_user_follow_business` on the **Instagram User Profile API** (`GET /<IGSID>`).
2. That API requires an **Instagram-scoped ID received from a messaging webhook** and documents:
   *"User consent is required to access an Instagram user's profile. User consent is set only when an
   Instagram user sends a message to your app user, or clicks an icebreaker or persistent menu."*
3. It explicitly states that if a user only comments and has not messaged the account, the app gets
   `User consent is required to access user profile`.
4. No documented endpoint lists followers or checks follow status from a comment ID or username.
5. The `comments` webhook contains the commenter's IGSID and username, but that IGSID is not usable
   with the User Profile API without messaging consent.

| Capability                                              | Status        | Consequence                                                        |
| ------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| Follow status for an arbitrary commenter at comment time| `UNSUPPORTED` | Strict follow gate cannot be implemented honestly.                |
| Follow status after the commenter messages the account  | `CONDITIONAL` | Possible via User Profile API + `instagram_business_manage_messages` + messaging consent. Not required for MVP. |
| Followers list / follower count of a private user       | `UNSUPPORTED` / `UNVERIFIED` | Not available for this use case.                     |
| "I followed" button click proof                         | `UNSUPPORTED` as proof | A click proves a click, nothing else.                   |

**Product decision:** implement an honest alternative.
- Every automation has a `follow_gate` setting with allowed values `off` and `instruction`. A `verify`
  mode exists in the type system and UI as **disabled**, with an explanation and a link to this
  document. The server rejects attempts to enable it.
- Public/private reply templates support a `{{follow_instructions}}` block: creators can ask people to
  follow, but the product never claims verification. The private reply is sent regardless, because
  holding the resource hostage to an unverifiable condition would be dishonest.
- A capability abstraction (`FollowStatusCapability`) and feature flags
  (`FOLLOW_VERIFICATION_ENABLED`, `FOLLOW_CHECK_ON_DM_ENABLED`) let a future verified implementation
  be added without schema or product rewrites. The post-DM check is implemented in the provider but
  remains disabled by default and is not surfaced as a gate.
- Analytics explicitly state resource clicks do **not** prove a follow.

Sources:
<https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile>,
<https://developers.facebook.com/documentation/instagram-platform/overview#automated-experiences>

---

## 10. Rate limits, pagination, versioning, errors

| Area              | Official limit / behavior                                                                                     | Implementation                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Non-messaging API | Instagram Business Use Case: `4800 × impressions` calls per rolling 24h per app-user pair.                     | Webhooks preferred over polling; media list paginated 25/page. |
| Private replies   | 750/hour/account (posts & Reels), 100/s (Live).                                                               | Local hourly budget (700) + per-account serialization. |
| Send API          | 100/s text; 10/s audio/video.                                                                                 | Worker concurrency 2; no media sends.        |
| Conversations API | 2/s.                                                                                                          | Not used in MVP.                            |
| Pagination        | Cursor-based (`paging.cursors.after`) on media/comments.                                                       | Follow `paging.next`-equivalent cursors with a hard page cap. |
| Versioning        | Versioned Graph API; v26.0 latest (2026-07-29), v25.0 supported until 2028-07-29.                             | Version pinned in config; no hard-coded URLs in modules. |
| Error envelope    | `{error:{message,type,code,error_subcode,error_user_title,error_user_msg,fbtrace_id}}`.                        | Parsed into a typed error.                  |
| Retryable         | Codes 1, 2, 4, 17, 341 and HTTP 429/5xx are transient.                                                         | Bounded retries with exponential backoff + jitter. |
| Permanent         | Codes 10/200–299 (permission), 190/102/463/467 (token), invalid parameters, 7-day/one-reply violations.        | Fail immediately, actionable message, no infinite retries. |
| Token errors      | 190 / OAuthException → mark account needs_reconnect.                                                          | Refresh attempt first, then disconnect state. |

Sources: <https://developers.facebook.com/documentation/instagram-platform/overview#rate-limiting>,
<https://developers.facebook.com/docs/graph-api/guides/error-handling>,
<https://developers.facebook.com/docs/graph-api/changelog>

---

## 11. Automation and platform policy constraints

From Meta's Platform Terms, Developer Policies, and the Instagram Platform docs:

- Use official APIs only. **No scraping, no password collection, no browser automation, no private
  endpoints.** This product does none of these.
- Do not send unsolicited promotional DMs. Comment-triggered private replies are the only outbound
  message path, and only one per comment within seven days.
- Disclose automated experiences where required (e.g. California, Germany) and follow the Instagram
  automated-chat policy. Creators own the message content; the UI recommends a clear disclosure in
  templates and provides a default disclosure snippet.
- Respect community standards and messaging policy: no harassment, spam, deceptive engagement, or
  incentivized-follow schemes that violate platform rules.
- Obtain and honor user consent; provide data deletion and deauthorization handling.
- Store only the data needed to operate automations. Do not persist profile pictures or unrelated
  personal data.

Sources: <https://developers.facebook.com/terms>, <https://developers.facebook.com/devpolicy>,
<https://help.instagram.com/655277382759165>

---

## 12. Meta app configuration checklist (for whoever operates this deployment)

1. Create a **Business** app at <https://developers.facebook.com/apps> and connect a verified business.
2. Add the **Instagram** product → **API setup with Instagram login**.
3. Add the Instagram professional account(s) used for testing under App Roles (Standard Access).
4. Configure **Business login settings**:
   - OAuth redirect URI: `https://<api-host>/api/instagram/oauth/callback`
   - Deauthorize callback: `https://<api-host>/webhooks/instagram/deauthorize`
   - Data deletion request URL: `https://<api-host>/webhooks/instagram/data-deletion`
5. Configure **Webhooks**:
   - Callback URL: `https://<api-host>/webhooks/instagram`
   - Verify token: same value as `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to `comments` (and `live_comments`; `messages` only for the optional DM follow check).
6. Submit **App Review** for `instagram_business_basic`, `instagram_business_manage_comments`
   (and `instagram_business_manage_messages` only if using DM features), with screen recordings.
7. Switch the app to **Live** (required for webhook delivery).
8. Set the app's **Data deletion instructions URL** and privacy policy URL.
9. Provide a valid HTTPS certificate on the webhook host — self-signed certificates are rejected.

Until steps 5–7 are complete, only accounts with a role on the app can be automated; the UI shows the
connection as **Test access** and explains why.

---

## 13. Residual risks and unknowns

| Risk / unknown                                                       | Impact                                                       | Mitigation                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| App Review duration/rejection                                        | Blocks serving third-party accounts.                         | Build for Standard Access testers first; clear reviewer notes in `docs/SETUP.md`. |
| Comment webhook payload shape differs between doc examples and reality | Parser must be defensive.                                    | Normalizer accepts flattened and `changes[]` shapes; fixtures cover both; unknown shapes are stored raw and marked `unsupported_payload`, never guessed. |
| Private reply content restrictions beyond text                       | Some message types may be rejected.                          | MVP sends text only; errors are surfaced verbatim (sanitized) with the fbtrace_id. |
| Token revocation endpoint                                            | Disconnect may leave the token valid until expiry.           | Delete locally, mark disconnected, instruct users how to remove app access in Instagram; handle deauthorize callback. |
| Live comments                                                        | Public replies impossible; private replies only during broadcast. | Rule builder excludes Live media for public replies and warns.             |
| Rate limits at scale (750 private replies/hour)                      | Bursts exceed budget.                                        | Local budget, visible skipped/queued states, no unlimited promises.        |
| Multi-instance worker rate accounting                                | Approximate under horizontal scaling.                        | Documented; move to a DB/Redis token bucket before scaling beyond one worker. |
| Meta API version deprecation                                         | Calls fail after sunset.                                     | Single version constant, changelog review documented.                       |

---

## 14. Source index

All sources accessed 2026-10-17.

1. Instagram Platform overview — <https://developers.facebook.com/documentation/instagram-platform/overview>
2. Instagram API with Instagram Login — <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login>
3. Business Login for Instagram — <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login>
4. Get started — <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started>
5. Webhooks — <https://developers.facebook.com/documentation/instagram-platform/webhooks>
6. Comment moderation — <https://developers.facebook.com/documentation/instagram-platform/comment-moderation>
7. Private replies — <https://developers.facebook.com/documentation/instagram-platform/private-replies>
8. Instagram User Profile API — <https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile>
9. Create an Instagram app — <https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app>
10. Graph API changelog / versions — <https://developers.facebook.com/docs/graph-api/changelog>
11. Graph API error handling — <https://developers.facebook.com/docs/graph-api/guides/error-handling>
12. Meta Platform Terms — <https://developers.facebook.com/terms>
13. Meta Developer Policies — <https://developers.facebook.com/devpolicy>
14. Automated chats on Instagram — <https://help.instagram.com/655277382759165>
