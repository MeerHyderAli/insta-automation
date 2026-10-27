# Comment-to-DM for Instagram (single account)

A small [Next.js](https://nextjs.org/) app for **one Instagram professional account**.
When someone comments on a post or Reel, the app verifies that the
commenter follows you, sends a “Thanks for commenting” private reply with a
**Click to get link** button, then verifies the follow **again** after the
button tap before sending **that Reel/post's link** — using only the
official Instagram API with Instagram Login. The trigger can be configured
keywords or **any non-empty comment**.

- Webhook route (`/api/webhook`) verifies Meta's `X-Hub-Signature-256` and
  handles both `comments` events and messaging events (button taps).
- Two trigger modes: case-insensitive, whole-word keywords (including your
  typo variants), or **any non-empty comment** (`COMMENT_MATCH_MODE=any`).
- **Different links per Reel/post, managed in the dashboard:** the
  dashboard's **Reel resources** section lists each media id seen in
  comments; paste that Reel's resource URL once and it is saved in the
  database for future comments — no env edit or redeploy. `MEDIA_LINKS_JSON`
  remains an optional env fallback. The button payload identifies the exact
  comment, so pending prompts from different Reels cannot deliver each
  other's links.
- **Follow status is checked twice, fail-closed both times:** check #1 runs
  before the thanks prompt is sent; check #2 runs again when the user taps
  the button. The link is sent only if Meta's `is_user_follow_business`
  field is `true` at check #2. A false/unverified result at check #1 means
  no prompt at all; at check #2 it means a follow-and-retry prompt, no link.
- Every comment ID is stored **before** sending, and every button-tap
  event ID is claimed before handling, so Meta redeliveries cannot produce
  duplicate prompts or links.
- The access token is read from an environment variable, server-side only —
  never hardcoded, never sent to the browser.
- A dashboard page lists the **last 50 comments** with the latest follow
  result and stage (prompt sent, waiting for tap, link sent, skipped, …).

No scraping, no unofficial endpoints, no password login, no public replies —
just the documented private-reply, quick-reply, and messaging flows.

---

## 1. Try it locally in 5 minutes (no Meta account needed)

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`: set any value for `META_APP_SECRET`, keep
`DRY_RUN=true`, set your trigger mode, keywords/messages, and temporarily set
`REQUIRE_FOLLOW_BEFORE_PROMPT=false` and `REQUIRE_FOLLOW_FOR_LINK=false`
for this sender-pipeline simulation. Fake local users cannot be verified
through Meta, so with the production follow checks enabled they are blocked
at check #1 as “follow unverified”. Keep both checks `true` in production.

```bash
npm run dev
```

In a second terminal, send a signed **fake** webhook (clearly a local
simulation, not a real Instagram event):

```bash
npm run simulate -- "LINK please!"
npm run simulate -- "send me the lnik" bob
npm run simulate -- "great post!" carol
```

Open <http://localhost:3000> — in the default keywords mode you should see
three comments: two "dry run" matches and one "no keyword". Run the first simulate command again with the
same comment id (the script prints the exact command) to prove dedupe:
the response reports `comments.duplicates: 1` and no second prompt/link
would be sent. The button stage is covered by the unit tests and the live
test in section 3.

Run the test suite any time:

```bash
npm test          # signature, matching, dedupe, API client, processing
npm run typecheck
npm run build
```

---

## 2. Configuration (environment variables)

Copy `.env.example` to `.env.local` locally; on your host, set the same
variables in its dashboard. **Never commit `.env.local`** (it is gitignored)
and never prefix a secret with `NEXT_PUBLIC_`.

| Variable | Required | What it is |
|---|---|---|
| `IG_ACCESS_TOKEN` | for real DMs | Long-lived Instagram Login token for your professional account. Server-side only. Expires ~60 days (see token refresh). |
| `META_APP_SECRET` | yes | Meta app secret. Used to verify `X-Hub-Signature-256` on every webhook POST. |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | A long random string **you invent**, pasted into Meta's webhook config. |
| `INTRO_DM_MESSAGE` | no | First private-reply prompt, sent only after check #1 passes. Default: “Thanks for commenting, {username}! Tap the button below to get your link.” |
| `GET_LINK_BUTTON_TEXT` | no | Quick-reply button label. Default `Click to get link`; Meta truncates titles after 20 characters, so the app caps this at 20. |
| `DM_MESSAGE` | no | Final message template sent after the button tap and check #2. Default `Here is your link: {link}`. `{username}` → e.g. `@alice`; `{keyword}` → matched word (empty in any-comment mode); `{link}` → selected Reel/post URL. |
| `MEDIA_LINKS_JSON` | no | Optional env fallback: single-line JSON object mapping Instagram **media id → URL**. Normally leave unset/`{}` and manage per-Reel links in the dashboard's Reel resources section; dashboard mappings override this. Invalid JSON/URLs fail closed when no dashboard mapping applies. |
| `DEFAULT_LINK_URL` | no | Optional fallback URL for media with no dashboard or `MEDIA_LINKS_JSON` entry. Leave unset if a new/unmapped Reel must receive nothing rather than a default link. |
| `NOT_FOLLOWING_MESSAGE` / `FOLLOW_UNVERIFIED_MESSAGE` | no | Prompts sent when check #2 returns false/unverified. Each carries a Try again button so the user can follow and re-check without commenting again. |
| `TRY_AGAIN_BUTTON_TEXT` | no | Retry button label. Default `Try again` (max 20 characters). |
| `REQUIRE_FOLLOW_BEFORE_PROMPT` | yes, keep `true` | Check #1, before the thanks prompt. False/unverified = no prompt DM at all. |
| `REQUIRE_FOLLOW_FOR_LINK` | yes, keep `true` | Check #2, after the button tap and before `DM_MESSAGE`. False/unverified = follow prompt, no link. |
| `REQUIRE_FOLLOW_TO_SEND` | legacy fallback | Older single-check setting. If either specific flag above is unset, this value is used for it. A specific flag always wins. |
| `COMMENT_MATCH_MODE` | no | `keywords` (default) or `any`. In `any` mode every non-empty comment triggers, with at most one prompt/link flow per user per Reel/post. |
| `COMMENT_KEYWORDS` | keywords mode | Comma-separated, case-insensitive, whole-word. Your keyword first, then typos. Default: `link,links,lnik,likn,lnk,liink,linkk` — change these to yours. Ignored in `any` mode. |
| `DATABASE_URL` | on serverless | Postgres connection string for durable dedupe storage. **Required on Vercel.** Empty = local JSON file store. |
| `DRY_RUN` | no | `true` = record matches but never call Instagram. Must be `false` in production. |
| `IG_ACCOUNT_ID` | no | Your professional account id; if set, events for other accounts are ignored. |
| `META_GRAPH_VERSION` | no | Default `v25.0`. Check Meta's changelog before changing. |
| `DATA_FILE` | no | Local file store path (only when `DATABASE_URL` is empty). Default `./data/comments.json`. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | required to edit resources | Enables Basic Auth on the dashboard. Resource add/edit/delete actions are refused unless both are set. Webhook/health stay public for Meta. |

---

## 3. Meta app setup, step by step

> You need: an **Instagram professional account** (Business or Creator) that
> is **public**. Personal/private accounts cannot use this API. A Facebook
> Page is **not** required for the Instagram Login setup.

### Step 1 — Create the Meta app

1. Go to <https://developers.facebook.com/apps> → **Create App**.
2. Choose the use case / type that lets you add the **Instagram** product
   (Business type). Name it anything, e.g. "Comment DM".
3. In the app dashboard, add the product **Instagram** and open
   **API setup with Instagram login** (not "API setup with Facebook login").

### Step 2 — Get the App Secret (deploy needs it, next section)

1. **Settings → Basic → App Secret → Show**. Copy it — this becomes
   `META_APP_SECRET`. Keep it server-side only.
2. Invent a long random string for the webhook verify token, e.g.
   `openssl rand -hex 24`. This becomes `META_WEBHOOK_VERIFY_TOKEN`.

### Step 3 — Deploy the app (before configuring the webhook)

Meta verifies your webhook URL the moment you save it, so the app must be
live first. Deploy with at least `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, `DATABASE_URL` (on Vercel),
`COMMENT_MATCH_MODE`, any `COMMENT_KEYWORDS`, `INTRO_DM_MESSAGE`,
`DM_MESSAGE`, and your per-Reel/default link settings set (see below).
`IG_ACCESS_TOKEN` can be added after Step 5.

### Step 4 — Configure the webhook

1. App dashboard → **Webhooks** → select **Instagram** → **Edit subscription**.
2. Callback URL: `https://YOUR-DOMAIN/api/webhook`
   (your exact production domain, HTTPS, no trailing slash).
3. Verify token: the exact string from `META_WEBHOOK_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta sends
   `GET /api/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
   and this app echoes the challenge when the token matches.
5. In **Webhook fields**, subscribe to **`comments`**, **`messages`**, and
   **`messaging_postbacks`** (the latter two deliver button taps; add
   `live_comments` only if you also want live-stream comments).

### Step 5 — Permissions and generate your access token

Under **Instagram → API setup with Instagram login**:

1. Make sure these permissions are added:
   - `instagram_business_basic`
   - `instagram_business_manage_comments` — receive `comments` webhooks /
     read comments.
   - `instagram_business_manage_messages` — read the profile follow field,
     send the private-reply prompt, receive button taps, and send the link.
2. Add/connect **your** Instagram professional account in the API setup page
   and use **Generate access token** for that account. Log in as that
   account and approve all three permissions.
3. Copy the token into `IG_ACCESS_TOKEN` in your host env, set
   `DRY_RUN=false`, `REQUIRE_FOLLOW_BEFORE_PROMPT=true`, and
   `REQUIRE_FOLLOW_FOR_LINK=true`, then redeploy. This dashboard-generated
   token is long-lived (~60 days). Treat it like a password.

> **Development mode is enough for your own account:** while the app is in
> Development mode, the API works for accounts that have a role in the app
> (you, as admin) and approved Instagram testers. Commenters do **not** need
> a role — they are just commenting on your media. If you later want this to
> work for *other people's* accounts, each permission needs **Advanced
> Access via App Review** (with screencasts) plus Business Verification, and
> the app must be switched Live. That is out of scope for this single-account
> app.

### Step 6 — Subscribe your account to the app's webhooks (easy to miss!)

Creating the webhook in the dashboard is not enough: your Instagram
account must be subscribed to the app. One-time call:

```bash
# with IG_ACCESS_TOKEN set in .env.local:
npm run ig:subscribe
# expected: {"success": true}
```

This runs
`POST /me/subscribed_apps` with
`subscribed_fields=comments,messages,messaging_postbacks`.

### Step 7 — Live test

1. From a **second** Instagram account that follows your professional
   account, first send your professional account any normal Instagram DM.
   This matters because Meta grants profile-access consent when a user
   messages the account; a comment alone may leave follow status
   unverifiable.
2. From that second account, comment on one of your posts/Reels — your
   keyword in keywords mode, or anything in any-comment mode. (Commenting
   from your own account is recorded as "Own comment" and never DMs you.)
   That Reel/post then appears in the dashboard's **Reel resources**
   section: paste its resource URL under its media id and click **Save
   resource** (no env edit or redeploy). Before it is mapped, an unmapped
   Reel fails closed with “No link configured for media …” and nobody is
   prompted, so map it and comment again for the full public test.
3. The commenter should receive **only** the “Thanks for commenting”
   prompt with a **Click to get link** button — no link yet. Tap it: the app
   checks the follow a second time and then sends the link. The dashboard
   row moves **Thanks prompt sent → Link sent**.
4. To prove check #2 is independent, repeat with another comment, unfollow
   after the prompt arrives, then tap the button: you should get the
   follow-and-**Try again** prompt instead of the link. Follow again and
   tap **Try again** to receive the link.
5. A commenter who fails check #1 appears as **Not following — no DM** or
   **Follow unverified — no DM** and receives nothing.

### Token refresh (~every 60 days)

Long-lived tokens expire after about 60 days and can be refreshed after 24
hours. Put a recurring reminder on day ~45 and run:

```bash
npm run ig:refresh-token   # prints the new token to your terminal only
```

Paste the new token into your host's `IG_ACCESS_TOKEN` and redeploy. If a
token already expired, generate a fresh one in the API setup page instead.

---

## 4. Deployment

### Option A — Vercel + free Postgres (recommended)

1. Create a free Postgres database (e.g. [Neon](https://neon.tech) or
   Supabase) and copy its connection string. The app creates its
   `processed_comments` table automatically on first use — no migrations to
   run.
2. Push this repo to GitHub, then on <https://vercel.com> → **Add New →
   Project** → import the repo. Framework preset: Next.js (defaults fine).
3. **Settings → Environment Variables** (Production): set everything from
   the config table, including `DATABASE_URL`, `DRY_RUN=false` (once your
   token is in), and `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.
4. Deploy. Check `https://YOUR-DOMAIN/api/health` — it reports which
   settings are present (never their values).
5. Continue with Meta setup Steps 4–7 using your production domain.

Vercel's free Hobby tier is enough for one account's comment volume; the
file store does **not** persist on Vercel, which is why `DATABASE_URL` is
required there.

### Option B — A small always-on server (Railway / Render / VPS)

```bash
npm install
npm run build
npm run start   # listens on $PORT / 3000
```

Set the same env vars. If the host gives you a persistent disk, you may
skip `DATABASE_URL` and keep the JSON file store (point `DATA_FILE` at the
persistent disk). Postgres is still recommended.

### Testing webhooks against localhost (optional)

Meta needs a public HTTPS URL. Use a tunnel and set the callback to
`https://YOUR-TUNNEL/api/webhook`:

```bash
cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

---

## 5. How it works

```
Someone comments "LINK please!" on your Reel
        │
        ▼
Meta comments webhook ─► verify X-Hub-Signature-256 (raw body)
                         CLAIM comment id                 ◄─ duplicate? stop
                         trigger? (keyword / ANY)       ◄─ no: record only
                         resolve Reel link (dashboard DB,
                           then env fallback)             ◄─ unmapped: no DM
                         FOLLOW CHECK #1
                           GET /<IGSID>?fields=is_user_follow_business
                                                          ◄─ not true: no DM
                         POST /<IG_ID>/messages
                           recipient.comment_id +
                           INTRO_DM_MESSAGE + [Click to get link]
        │ user taps the button
        ▼
Meta messages webhook ─► CLAIM tap event id               ◄─ duplicate? stop
                         FOLLOW CHECK #2 (again)
                           ├─ true        ─► send DM_MESSAGE with that Reel's {link}
                           └─ false/unknown ─► send follow prompt + [Try again]
Dashboard (/) ◄── last 50 records from the same store
```

Files:

| Path | Purpose |
|---|---|
| `app/api/webhook/route.ts` | GET verification handshake + POST event handler |
| `app/page.tsx` | Dashboard: last 50 comments + setup checklist |
| `app/api/health/route.ts` | Non-secret config/status smoke check |
| `middleware.ts` | Optional Basic Auth for the dashboard |
| `lib/signature.ts` | HMAC-SHA256 verification (constant-time) |
| `lib/parse.ts` | Webhook payload → comment events + messaging (tap) events |
| `lib/keywords.ts` | Case-insensitive whole-word matching |
| `lib/process.ts` | Comment stage (check #1 → prompt) and tap stage (check #2 → link/prompt) |
| `lib/instagram.ts` | Follow-status, private-reply, and conversation-message API clients |
| `lib/store.ts` | Postgres or JSON-file store with atomic claim |
| `lib/config.ts` | All env parsing (tokens never hardcoded) |
| `scripts/simulate-webhook.mjs` | Signed fake webhook for local testing |
| `scripts/subscribe-webhooks.mjs` | `POST /me/subscribed_apps` one-time setup |
| `scripts/refresh-token.mjs` | Long-lived token refresh helper |
| `test/` | 57 unit tests (signature, keyword/any matching, dashboard-managed per-Reel links, dedupe, both follow checks, retry flow, API clients) |

---

## 6. Rules & limitations (from Meta's docs — not app bugs)

- **One private reply per comment**, within **7 days** of the comment (for
  Live comments, only during the broadcast) — that one reply is the thanks
  prompt. The button tap is a user message, which opens the standard
  24-hour messaging window for the link/follow-prompt follow-ups.
- **Private-reply quick replies still need one controlled live check.**
  Meta documents quick replies and private replies on the same
  `/messages` endpoint, but the official pages fetched for this project do
  not show a combined `recipient.comment_id` + `quick_replies` example.
  The request shape is implemented and unit-tested; if Meta rejects that
  combination for your app/account, the record will show `failed` with
  Meta's error and no link will be sent. Verify this in Step 7 before
  announcing the campaign publicly.
- Messages to people who don't follow you may land in **Message requests**.
- Rate limit for private replies to post/Reel comments: **750/hour per
  account** — far above what one account normally needs.
- Without `DATABASE_URL` on a serverless host, dedupe state lives in
  `/tmp` and can be lost between invocations; the dashboard warns about
  this. Meta's own one-reply-per-comment rule is the last line of defence.
- The app sends no public comment replies. Both follow checks use the same
  Meta field, but verification is limited by Meta: the User Profile API
  uses an Instagram-scoped ID and requires profile-access consent. Consent
  is granted when the user messages your professional account or uses an
  icebreaker/persistent menu; **commenting alone does not grant it**.
  Consequently, a genuine follower who has never messaged you may fail
  check #1 as “follow unverified” and receive nothing — that is the
  requested strict behaviour, and the app never guesses. Official
  references: [User Profile API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile),
  [Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies),
  and [Quick Replies](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies).
- Comment text and usernames are stored (needed for the dashboard and
  dedupe). Files: local mode caps at the newest 500 records; delete rows /
  the data file whenever you want a clean slate.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Verify and save" fails in Meta | App not deployed yet; wrong callback URL (must be `https://YOUR-DOMAIN/api/webhook`); verify token mismatch with `META_WEBHOOK_VERIFY_TOKEN`. |
| No events arrive | `comments` field not subscribed; `npm run ig:subscribe` not run; account is private/personal; token was generated before adding the comment/message permissions (regenerate it). |
| Prompt arrives but tapping the button does nothing | `messages` / `messaging_postbacks` webhook fields not subscribed (dashboard + `npm run ig:subscribe`); check the dashboard row — `follow_prompt_sent` means check #2 returned false/unverified, so follow and tap **Try again**. |
| `403 Invalid signature` in logs | `META_APP_SECRET` doesn't match the app that sends the webhooks. |
| DM status `failed` + code 190 / 463 | Token expired/invalid — refresh or regenerate, update env, redeploy. |
| DM status `failed` + permission error | Token lacks `instagram_business_manage_messages` — add the permission, regenerate the token. |
| “Not following — no DM” at the comment stage | Working as intended: check #1 returned `is_user_follow_business=false`, so no prompt was sent. The person must follow and comment again. (After a prompt, a false check #2 instead sends the follow-and-Try-again message.) |
| “No link configured for media …” | In the dashboard's Reel resources section, paste that Reel's URL under its media id and save (dashboard credentials required), then comment again. `MEDIA_LINKS_JSON` / `DEFAULT_LINK_URL` remain optional env fallbacks. No prompt is sent for an unmapped Reel. |
| Comments trigger nothing in any-comment mode | Confirm `COMMENT_MATCH_MODE=any` on the deployed build (`/api/health`), the comment is non-empty, and the same user does not already have a prompt/link flow for that Reel. |
| “Follow unverified — no DM” at the comment stage | Check #1 could not obtain a boolean, commonly because the commenter has not previously messaged your account to grant profile consent. The app sends nothing. Check Detail for Meta's error; token/permission problems can also appear here. |
| Duplicate test comments all say `duplicates: 1` | Working as intended — that comment id was already claimed. Use a new comment (or new `-- id` in simulate). |
| Dashboard shows old data after redeploy on Vercel | `DATABASE_URL` missing → ephemeral `/tmp` store. Add Postgres. |
