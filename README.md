# Comment-to-DM for Instagram (single account)

A small [Next.js](https://nextjs.org/) app for **one Instagram professional account**.
When someone comments your keyword on a post or Reel, the app checks
whether Meta verifies that commenter as a follower. Only then does it send
that commenter **one private reply (DM)** with your message and link, using
only the **official Instagram API with Instagram Login**.

- Webhook route (`/api/webhook`) verifies Meta's `X-Hub-Signature-256` and
  handles `comments` events.
- Case-insensitive, whole-word keyword matching, including your typo
  variants (configurable list).
- **Follower-only, fail-closed:** before sending, the app reads Meta's
  `is_user_follow_business` field. It sends only on `true`; `false` and
  “could not verify” both result in no DM.
- Every comment ID is stored **before** sending, so Meta redeliveries or
  duplicate notifications can never produce a second DM.
- The access token is read from an environment variable, server-side only —
  never hardcoded, never sent to the browser.
- A dashboard page lists the **last 50 comments** and whether a DM went out
  (only API-confirmed sends are shown as "sent").

No scraping, no unofficial endpoints, no password login, no public replies —
just the documented private-reply flow.

---

## 1. Try it locally in 5 minutes (no Meta account needed)

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`: set any value for `META_APP_SECRET`, keep
`DRY_RUN=true`, set your `COMMENT_KEYWORDS` / `DM_MESSAGE`, and temporarily
set `REQUIRE_FOLLOW_TO_SEND=false` for this sender-pipeline simulation.
Fake local users cannot be verified through Meta, so with the production
follow gate enabled they are correctly blocked as “follow unverified”. Set
the gate back to `true` for production.

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

Open <http://localhost:3000> — you should see three comments: two "dry run"
matches and one "no keyword". Run the first simulate command again with the
same comment id (the script prints the exact command) to prove dedupe:
the response reports `duplicates: 1` and no second DM would be sent.

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
| `DM_MESSAGE` | for real DMs | The private reply text, including your link. `{username}` → e.g. `@alice`; `{keyword}` → matched word. |
| `REQUIRE_FOLLOW_TO_SEND` | yes, keep `true` | Follower-only gate. Default is also `true` when unset. Send only if Meta returns `is_user_follow_business=true`; false/unverified = no DM. Set `false` only for local dry-run pipeline tests. |
| `COMMENT_KEYWORDS` | no | Comma-separated, case-insensitive, whole-word. Your keyword first, then typos. Default: `link,links,lnik,likn,lnk,liink,linkk` — change these to yours. |
| `DATABASE_URL` | on serverless | Postgres connection string for durable dedupe storage. **Required on Vercel.** Empty = local JSON file store. |
| `DRY_RUN` | no | `true` = record matches but never call Instagram. Must be `false` in production. |
| `IG_ACCOUNT_ID` | no | Your professional account id; if set, events for other accounts are ignored. |
| `META_GRAPH_VERSION` | no | Default `v25.0`. Check Meta's changelog before changing. |
| `DATA_FILE` | no | Local file store path (only when `DATABASE_URL` is empty). Default `./data/comments.json`. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | recommended | Enables Basic Auth on the dashboard page (it shows usernames + comment text). Webhook/health stay public for Meta. |

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
`COMMENT_KEYWORDS` and `DM_MESSAGE` set (see deployment section below).
`IG_ACCESS_TOKEN` can be added after Step 5.

### Step 4 — Configure the webhook

1. App dashboard → **Webhooks** → select **Instagram** → **Edit subscription**.
2. Callback URL: `https://YOUR-DOMAIN/api/webhook`
   (your exact production domain, HTTPS, no trailing slash).
3. Verify token: the exact string from `META_WEBHOOK_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta sends
   `GET /api/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
   and this app echoes the challenge when the token matches.
5. In **Webhook fields**, subscribe to **`comments`** (add `live_comments`
   only if you also want live-stream comments).

### Step 5 — Permissions and generate your access token

Under **Instagram → API setup with Instagram login**:

1. Make sure these permissions are added:
   - `instagram_business_basic`
   - `instagram_business_manage_comments` — receive `comments` webhooks /
     read comments.
   - `instagram_business_manage_messages` — read the profile follow field
     and send the private reply DM.
2. Add/connect **your** Instagram professional account in the API setup page
   and use **Generate access token** for that account. Log in as that
   account and approve all three permissions.
3. Copy the token into `IG_ACCESS_TOKEN` in your host env, set
   `DRY_RUN=false` and `REQUIRE_FOLLOW_TO_SEND=true`, and redeploy. This
   dashboard-generated token is long-lived (~60 days). Treat it like a
   password.

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
`POST https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=comments`.

### Step 7 — Live test

1. From a **second** Instagram account that follows your professional
   account, first send your professional account any normal Instagram DM.
   This matters because Meta grants profile-access consent when a user
   messages the account; a comment alone may leave follow status
   unverifiable.
2. From that second account, comment your keyword (e.g. `LINK`) on one of
   your posts/Reels. (Commenting from your own account is recorded as
   "Own comment" and never DMs you.)
3. Open your dashboard (`https://YOUR-DOMAIN/`). A verified follower should
   appear as **Verified follower → DM sent** with a message id. A
   non-follower appears as **Not following — no DM**; someone Meta cannot
   verify appears as **Follow unverified — no DM**.

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
Meta ──POST /api/webhook (signed)──► verify X-Hub-Signature-256 (raw body)
                                      parse `comments` change
                                      CLAIM comment id in store  ◄─ duplicate? stop
                                      keyword match?             ◄─ no: record only
                                      GET /<IGSID>?fields=
                                        is_user_follow_business  ◄─ not true: stop
                                      POST /<IG_ID>/messages
                                        { recipient: { comment_id },
                                          message: { text: DM_MESSAGE } }
                                      record sent + message id / failed + error
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
| `lib/parse.ts` | Webhook payload → comment events |
| `lib/keywords.ts` | Case-insensitive whole-word matching |
| `lib/process.ts` | Claim → match → verify follower → send → record pipeline |
| `lib/instagram.ts` | Follow-status + private-reply API clients (sanitized errors) |
| `lib/store.ts` | Postgres or JSON-file store with atomic claim |
| `lib/config.ts` | All env parsing (tokens never hardcoded) |
| `scripts/simulate-webhook.mjs` | Signed fake webhook for local testing |
| `scripts/subscribe-webhooks.mjs` | `POST /me/subscribed_apps` one-time setup |
| `scripts/refresh-token.mjs` | Long-lived token refresh helper |
| `test/` | 39 unit tests (signature, matching, parsing, dedupe, follower gate, processing, API clients) |

---

## 6. Rules & limitations (from Meta's docs — not app bugs)

- **One private reply per comment**, within **7 days** of the comment (for
  Live comments, only during the broadcast). After the commenter replies,
  the standard 24-hour messaging window applies to further messages.
- Messages to people who don't follow you may land in **Message requests**.
- Rate limit for private replies to post/Reel comments: **750/hour per
  account** — far above what one account normally needs.
- Without `DATABASE_URL` on a serverless host, dedupe state lives in
  `/tmp` and can be lost between invocations; the dashboard warns about
  this. Meta's own one-reply-per-comment rule is the last line of defence.
- The app sends no public comment replies. Its private reply is
  follower-gated, but verification is limited by Meta: the User Profile API
  uses an Instagram-scoped ID and requires profile-access consent. Consent
  is granted when the user messages your professional account or uses an
  icebreaker/persistent menu; **commenting alone does not grant it**.
  Consequently, a genuine follower who has never messaged you may be
  recorded as “follow unverified” and receive nothing. The app intentionally
  fails closed rather than guessing. Official references:
  [User Profile API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile)
  and [Private Replies](https://developers.facebook.com/documentation/instagram-platform/private-replies).
- Comment text and usernames are stored (needed for the dashboard and
  dedupe). Files: local mode caps at the newest 500 records; delete rows /
  the data file whenever you want a clean slate.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Verify and save" fails in Meta | App not deployed yet; wrong callback URL (must be `https://YOUR-DOMAIN/api/webhook`); verify token mismatch with `META_WEBHOOK_VERIFY_TOKEN`. |
| No events arrive | `comments` field not subscribed; `npm run ig:subscribe` not run; account is private/personal; token was generated before adding the comment/message permissions (regenerate it). |
| `403 Invalid signature` in logs | `META_APP_SECRET` doesn't match the app that sends the webhooks. |
| DM status `failed` + code 190 / 463 | Token expired/invalid — refresh or regenerate, update env, redeploy. |
| DM status `failed` + permission error | Token lacks `instagram_business_manage_messages` — add the permission, regenerate the token. |
| “Not following — no DM” | Working as intended: Meta returned `is_user_follow_business=false`. Ask the person to follow and make a new keyword comment. |
| “Follow unverified — no DM” | Meta did not return a boolean, commonly because the commenter has not previously messaged your account to grant profile consent. The app sends nothing. Check Detail for Meta's error; token/permission problems can also appear here. |
| Duplicate test comments all say `duplicates: 1` | Working as intended — that comment id was already claimed. Use a new comment (or new `-- id` in simulate). |
| Dashboard shows old data after redeploy on Vercel | `DATABASE_URL` missing → ephemeral `/tmp` store. Add Postgres. |
