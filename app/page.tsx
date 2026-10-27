import { getConfig, getConfigStatus } from '../lib/config';
import { listOwnMedia, type InstagramMediaSummary } from '../lib/instagram';
import { getStore } from '../lib/store';
import type { CommentRecord, DmStatus, FollowStatus, MediaResource } from '../lib/types';
import { deleteMediaResource, saveMediaResource, subscribeInstagramAccount } from './actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<DmStatus, string> = {
  prompt_sent: 'Thanks prompt sent',
  checking_follow: 'Checking follow…',
  follow_prompt_sent: 'Follow prompt sent',
  link_sent: 'Link sent',
  sent: 'DM sent',
  failed: 'DM failed',
  not_matched: 'No keyword',
  dry_run: 'Dry run (not sent)',
  skipped_own_comment: 'Own comment',
  skipped_not_following: 'Not following — no DM',
  skipped_follow_unverified: 'Follow unverified — no DM',
  skipped_duplicate_for_media: 'Already handled for this Reel/post',
  processing: 'Processing…',
};

const FOLLOW_LABEL: Record<FollowStatus, string> = {
  following: 'Verified follower',
  not_following: 'Not following',
  unverified: 'Could not verify',
  not_checked: 'Not checked',
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function StatusDot({ state }: { state: 'ok' | 'missing' | 'warn' }) {
  return <span className={`dot dot-${state}`} aria-hidden="true" />;
}

interface DashboardPageProps {
  searchParams?: Promise<{
    resourceStatus?: string | string[];
    setupStatus?: string | string[];
    setupError?: string | string[];
  }>;
}

const SETUP_STATUS_MESSAGES: Record<string, string> = {
  subscribed:
    'Instagram account subscribed to comments, messages, and messaging_postbacks webhooks.',
  'auth-required': 'Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD before using dashboard setup actions.',
  'token-missing': 'Add IG_ACCESS_TOKEN in Vercel before subscribing the Instagram account.',
  'subscribe-error': 'Instagram webhook subscription failed.',
};

const RESOURCE_STATUS_MESSAGES: Record<string, string> = {
  saved: 'Resource saved. New comments on that Reel will use it immediately — no redeploy needed.',
  deleted: 'Dashboard resource removed. Any env/default fallback for that Reel now applies again.',
  invalid: 'Please enter a valid media ID and an http(s) resource URL (label max 120 characters).',
  'auth-required': 'Set DASHBOARD_USERNAME and DASHBOARD_PASSWORD to enable editing resources here.',
  error: 'Could not save that resource. Check the storage/database connection and try again.',
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const config = getConfig();
  const status = getConfigStatus(config);
  const params = (await searchParams) ?? {};
  const resourceStatus = Array.isArray(params.resourceStatus)
    ? params.resourceStatus[0]
    : params.resourceStatus;
  const resourceStatusMessage = resourceStatus
    ? RESOURCE_STATUS_MESSAGES[resourceStatus]
    : null;
  const setupStatus = Array.isArray(params.setupStatus) ? params.setupStatus[0] : params.setupStatus;
  const setupError = Array.isArray(params.setupError) ? params.setupError[0] : params.setupError;
  const setupStatusMessage = setupStatus
    ? setupStatus === 'subscribe-error' && setupError
      ? `${SETUP_STATUS_MESSAGES[setupStatus]} ${setupError}`
      : SETUP_STATUS_MESSAGES[setupStatus]
    : null;
  const resourceWritesEnabled = Boolean(
    process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_PASSWORD,
  );

  const store = getStore(config);
  let records: CommentRecord[] = [];
  let mediaResources: MediaResource[] = [];
  let storeError: string | null = null;
  try {
    records = await store.list(50);
    mediaResources = await store.listMediaResources();
  } catch (error) {
    storeError = error instanceof Error ? error.message : 'Could not read the comment store';
  }

  let instagramMedia: InstagramMediaSummary[] = [];
  let instagramMediaError: string | null = null;
  if (config.accessToken) {
    try {
      instagramMedia = await listOwnMedia({
        igAccountId: config.igAccountId,
        accessToken: config.accessToken,
        graphVersion: config.graphVersion,
        limit: 25,
      });
    } catch (error) {
      instagramMediaError =
        error instanceof Error ? error.message : 'Could not load Instagram media';
    }
  }
  const instagramMediaById = new Map(instagramMedia.map((media) => [media.id, media]));

  const dashboardResourcesByMedia = new Map(
    mediaResources.map((resource) => [resource.mediaId, resource]),
  );
  interface ReelSummary {
    mediaId: string;
    commentCount: number;
    lastSeenAt: string | null;
    latestComment: CommentRecord | null;
    instagramMedia: InstagramMediaSummary | null;
    dashboardResource: MediaResource | null;
    envUrl: string | null;
    effectiveUrl: string | null;
    source: 'Dashboard' | 'Env fallback' | 'Default fallback' | 'Single DM_MESSAGE' | 'Not mapped';
  }
  const reelMap = new Map<string, ReelSummary>();
  const ensureReel = (mediaId: string): ReelSummary => {
    const existing = reelMap.get(mediaId);
    if (existing) return existing;
    const dashboardResource = dashboardResourcesByMedia.get(mediaId) ?? null;
    const envUrl = config.mediaLinks[mediaId] ?? null;
    const effectiveUrl = dashboardResource?.url ?? envUrl ?? config.defaultLinkUrl;
    const created: ReelSummary = {
      mediaId,
      commentCount: 0,
      lastSeenAt: null,
      latestComment: null,
      instagramMedia: instagramMediaById.get(mediaId) ?? null,
      dashboardResource,
      envUrl,
      effectiveUrl,
      source: dashboardResource
        ? 'Dashboard'
        : envUrl
          ? 'Env fallback'
          : config.defaultLinkUrl
            ? 'Default fallback'
            : status.dmMessageUsesLinkPlaceholder
              ? 'Not mapped'
              : 'Single DM_MESSAGE',
    };
    reelMap.set(mediaId, created);
    return created;
  };
  for (const record of records) {
    if (!record.mediaId) continue;
    const reel = ensureReel(record.mediaId);
    reel.commentCount += 1;
    if (!reel.latestComment) {
      reel.latestComment = record;
      reel.lastSeenAt = record.receivedAt;
    }
  }
  for (const mediaId of Object.keys(config.mediaLinks)) ensureReel(mediaId);
  for (const resource of mediaResources) ensureReel(resource.mediaId);
  for (const media of instagramMedia) ensureReel(media.id);
  const reels = [...reelMap.values()].sort((a, b) => {
    const aTime = a.lastSeenAt ?? a.instagramMedia?.timestamp ?? a.dashboardResource?.updatedAt ?? '';
    const bTime = b.lastSeenAt ?? b.instagramMedia?.timestamp ?? b.dashboardResource?.updatedAt ?? '';
    return bTime.localeCompare(aTime);
  });
  const mappedReelCount = new Set([
    ...mediaResources.map((resource) => resource.mediaId),
    ...Object.keys(config.mediaLinks),
  ]).size;

  const linkSent = records.filter(
    (record) => record.dmStatus === 'link_sent' || record.dmStatus === 'sent',
  ).length;
  const waiting = records.filter((record) =>
    ['prompt_sent', 'follow_prompt_sent', 'checking_follow'].includes(record.dmStatus),
  ).length;
  const matched = records.filter((record) => record.matchedKeyword).length;
  const triggerLabel = (record: CommentRecord): string =>
    record.matchedKeyword === '*'
      ? 'ANY'
      : (record.matchedKeyword ?? '—');
  const failed = records.filter((record) => record.dmStatus === 'failed').length;

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <div className="logo" aria-hidden="true">💬</div>
          <div>
            <div className="title">Comment-to-DM</div>
            <div className="subtitle">
              {status.commentMatchMode === 'any'
                ? 'Any comment is follow-checked, receives a thanks prompt with a button, then is follow-checked again before that Reel’s link is sent.'
                : 'Keyword comments are follow-checked, receive a thanks prompt with a button, then are follow-checked again before the link is sent.'}
            </div>
          </div>
        </div>
        <div className="actions">
          <a className="button" href="/">↻ Refresh</a>
          <a className="button" href="/api/health">Health JSON</a>
        </div>
      </header>

      {storeError ? (
        <div className="banner banner-error">
          <strong>Storage error:</strong> {storeError}. Check <code>DATABASE_URL</code> (or the
          local data file) — without storage the app cannot deduplicate comments safely.
        </div>
      ) : null}

      {setupStatusMessage ? (
        <div className={setupStatus === 'subscribed' ? 'banner banner-warn' : 'banner banner-error'}>
          {setupStatusMessage}
        </div>
      ) : null}

      {status.requireFollowBeforePrompt || status.requireFollowForLink ? (
        <div className="banner banner-warn">
          <strong>Double follow check:</strong> check #1 runs before the thanks prompt;
          check #2 runs again after the <code>{status.getLinkButtonText}</code> button tap.
          The link is sent only when Meta returns <code>is_user_follow_business=true</code>{' '}
          at the second check.
        </div>
      ) : null}

      {status.dryRun ? (
        <div className="banner banner-warn">
          <strong>DRY_RUN is on.</strong> Matching comments are recorded but no DM is sent to
          Instagram. Set <code>DRY_RUN=false</code> when you are ready to go live.
        </div>
      ) : null}

      {!status.storageDurable ? (
        <div className="banner banner-warn">
          <strong>Using the local file store.</strong> Fine on your machine or a single server,
          but on serverless hosts (Vercel) it does not persist between invocations — set{' '}
          <code>DATABASE_URL</code> before going live or duplicate DMs become possible.
        </div>
      ) : null}

      <section className="stats" aria-label="Summary of the last 50 comments">
        <div className="stat">
          <div className="stat-value">{records.length}</div>
          <div className="stat-label">Comments seen (last 50)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{matched}</div>
          <div className="stat-label">Trigger matches</div>
        </div>
        <div className="stat">
          <div className="stat-value">{linkSent}</div>
          <div className="stat-label">Links delivered</div>
        </div>
        <div className="stat">
          <div className="stat-value">{waiting}</div>
          <div className="stat-label">Waiting for button tap</div>
        </div>
        <div className="stat">
          <div className="stat-value">{failed}</div>
          <div className="stat-label">DM failures</div>
        </div>
      </section>

      <section className="card" id="setup-checklist" aria-label="Setup checklist">
        <h2>Setup checklist</h2>
        <ul className="checklist">
          <li>
            <StatusDot state={status.verifyTokenConfigured ? 'ok' : 'missing'} />
            <span>
              Webhook verify token {status.verifyTokenConfigured ? 'configured' : 'missing'}{' '}
              <span className="muted">
                (<code>META_WEBHOOK_VERIFY_TOKEN</code> — Meta callback URL is{' '}
                <code>https://YOUR-DOMAIN/api/webhook</code>)
              </span>
            </span>
          </li>
          <li>
            <StatusDot state={status.appSecretConfigured ? 'ok' : 'missing'} />
            <span>
              App secret {status.appSecretConfigured ? 'configured' : 'missing'}{' '}
              <span className="muted">(<code>META_APP_SECRET</code>, used to verify signatures)</span>
            </span>
          </li>
          <li>
            <StatusDot state={status.accessTokenConfigured ? 'ok' : 'missing'} />
            <span>
              Instagram access token {status.accessTokenConfigured ? 'configured' : 'missing'}{' '}
              <span className="muted">
                (<code>IG_ACCESS_TOKEN</code>, server-side only, expires ~60 days)
              </span>
            </span>
          </li>
          <li>
            <StatusDot state={status.dmMessageConfigured ? 'ok' : 'missing'} />
            <span>
              Final link template {status.dmMessageConfigured ? 'configured' : 'missing'}{' '}
              <span className="muted">
                (<code>DM_MESSAGE</code>
                {status.dmMessageUsesLinkPlaceholder ? ', uses {link}' : ''})
              </span>
            </span>
          </li>
          <li>
            <StatusDot state="ok" />
            <span>
              Comment trigger:{' '}
              {status.commentMatchMode === 'any'
                ? 'any non-empty comment'
                : 'configured keywords'}{' '}
              <span className="muted">(<code>COMMENT_MATCH_MODE</code>)</span>
            </span>
          </li>
          <li>
            <StatusDot
              state={
                mappedReelCount > 0 || status.defaultLinkConfigured
                  ? 'ok'
                  : status.dmMessageUsesLinkPlaceholder
                    ? 'missing'
                    : 'warn'
              }
            />
            <span>
              Per-Reel links: {mediaResources.length} saved in this dashboard
              {status.mediaLinkCount > 0 ? `, ${status.mediaLinkCount} optional env fallback(s)` : ''}
              {status.defaultLinkConfigured ? ', default fallback configured' : ''}{' '}
              <span className="muted">(manage them in <a href="#reel-resources">Reel resources</a> below — no redeploy)</span>
            </span>
          </li>
          <li>
            <StatusDot state={status.requireFollowBeforePrompt ? 'ok' : 'warn'} />
            <span>
              Follow check #1 (before prompt):{' '}
              {status.requireFollowBeforePrompt ? 'enabled' : 'disabled'}{' '}
              <span className="muted">(<code>REQUIRE_FOLLOW_BEFORE_PROMPT</code>)</span>
            </span>
          </li>
          <li>
            <StatusDot state={status.requireFollowForLink ? 'ok' : 'warn'} />
            <span>
              Follow check #2 (after button tap):{' '}
              {status.requireFollowForLink ? 'enabled' : 'disabled'}{' '}
              <span className="muted">(<code>REQUIRE_FOLLOW_FOR_LINK</code>)</span>
            </span>
          </li>
          <li>
            <StatusDot state={status.storageDurable ? 'ok' : 'warn'} />
            <span>
              Storage: <code>{status.storage}</code>
              {status.storageDurable
                ? ' (durable — dedupe survives restarts/redeploys)'
                : ' (local file — set DATABASE_URL for production)'}
            </span>
          </li>
          <li>
            <StatusDot state={status.dryRun ? 'warn' : 'ok'} />
            <span>
              Mode: {status.dryRun ? 'dry run — nothing is sent' : `live (Graph ${status.graphVersion})`}
            </span>
          </li>
        </ul>

        <form action={subscribeInstagramAccount} className="setup-action">
          <div>
            <strong>Instagram webhook account subscription</strong>
            <div className="small muted">
              Verifying the callback in Meta is app-level. Click this once to subscribe the
              token’s Instagram account to <code>comments</code>, <code>messages</code>, and{' '}
              <code>messaging_postbacks</code> so comment and button-tap events are delivered here.
            </div>
          </div>
          <button
            className="button button-primary"
            type="submit"
            disabled={!resourceWritesEnabled || !status.accessTokenConfigured}
          >
            Subscribe my account
          </button>
        </form>

        <div className="small muted" style={{ marginTop: 12 }}>
          {status.commentMatchMode === 'any' ? (
            <>Any-comment mode is on: the keyword list below is ignored unless you switch back.</>
          ) : (
            <>Keywords (case-insensitive, whole word):</>
          )}
          <div className="chips">
            {status.keywords.map((keyword) => (
              <span className="chip" key={keyword}>{keyword}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="card" id="reel-resources" aria-label="Reel resources">
        <h2>Reel resources</h2>
        <div className="small muted">
          Your recent Instagram Reels/posts are loaded from Instagram below, together with any
          media seen in comments. Add each Reel’s resource link under it; it is saved in the
          database and used for future comments on that media ID immediately — no Vercel env edit
          and no redeploy. Dashboard mappings override the optional env fallback (
          <code>MEDIA_LINKS_JSON</code>).
        </div>

        {resourceStatusMessage ? (
          <div className="resource-status">{resourceStatusMessage}</div>
        ) : null}
        {!status.mediaLinksConfigValid ? (
          <div className="resource-status resource-status-error">
            The optional <code>MEDIA_LINKS_JSON</code> / <code>DEFAULT_LINK_URL</code> env fallback is
            invalid. Dashboard mappings above still work; fix or remove the env value when convenient.
          </div>
        ) : null}
        {instagramMediaError ? (
          <div className="resource-status resource-status-error">
            Couldn’t load your recent Instagram Reels/posts: {instagramMediaError}. Check that the
            token belongs to the professional account and includes <code>instagram_business_basic</code>.
            Comment-seen Reels and manual media-ID mapping below still work.
          </div>
        ) : null}
        {!status.accessTokenConfigured ? (
          <div className="resource-status resource-status-error">
            Add <code>IG_ACCESS_TOKEN</code> to automatically list your recent Instagram Reels/posts here.
          </div>
        ) : null}
        {!resourceWritesEnabled ? (
          <div className="resource-status resource-status-error">
            Resource editing is disabled until <code>DASHBOARD_USERNAME</code> and{' '}
            <code>DASHBOARD_PASSWORD</code> are set, so a public visitor cannot change your links.
          </div>
        ) : null}

        <form action={saveMediaResource} className="resource-form resource-form-manual">
          <label className="field" htmlFor="manual-media-id">
            Reel / media ID
            <input
              id="manual-media-id"
              name="mediaId"
              placeholder="17900000000000001"
              required
              disabled={!resourceWritesEnabled}
            />
          </label>
          <label className="field" htmlFor="manual-resource-label">
            Resource name (optional)
            <input
              id="manual-resource-label"
              name="label"
              placeholder="Free guide, template…"
              maxLength={120}
              disabled={!resourceWritesEnabled}
            />
          </label>
          <label className="field" htmlFor="manual-resource-url">
            Resource URL
            <input
              id="manual-resource-url"
              name="url"
              type="url"
              placeholder="https://example.com/resource"
              required
              disabled={!resourceWritesEnabled}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={!resourceWritesEnabled}>
            Add resource
          </button>
        </form>

        {reels.length === 0 ? (
          <div className="empty">
            <strong>No Reels/posts found yet</strong>
            {status.accessTokenConfigured
              ? 'Instagram returned no recent media for this token/account, and no comment media has been seen yet. Check the token account, or add a media ID manually above.'
              : 'Add IG_ACCESS_TOKEN to load your recent Reels/posts automatically. Until then, a Reel appears here after its first comment webhook, or you can add its media ID manually above.'}
          </div>
        ) : (
          <div className="resource-list">
            {reels.map((reel) => (
              <article className="resource-item" key={reel.mediaId}>
                <div className="resource-head">
                  <div className="resource-media">
                    {reel.instagramMedia?.thumbnailUrl ||
                    (reel.instagramMedia?.mediaType !== 'VIDEO' ? reel.instagramMedia?.mediaUrl : null) ? (
                      // Instagram returns short-lived CDN URLs; a plain img avoids
                      // needing to allowlist their changing image hosts.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="resource-thumb"
                        src={
                          reel.instagramMedia?.thumbnailUrl ??
                          (reel.instagramMedia?.mediaType !== 'VIDEO'
                            ? reel.instagramMedia?.mediaUrl ?? ''
                            : '')
                        }
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <div className="resource-thumb resource-thumb-empty" aria-hidden="true">▶</div>
                    )}
                    <div>
                      <div className="resource-title">
                        <span>
                          {reel.dashboardResource?.label ||
                            (reel.instagramMedia?.mediaType === 'VIDEO'
                              ? 'Reel / video'
                              : reel.instagramMedia?.mediaType || 'Reel / post')}
                        </span>
                        <code>{reel.mediaId}</code>
                      </div>
                      <div className="small muted">
                        {reel.instagramMedia?.timestamp
                          ? `Published ${formatTime(reel.instagramMedia.timestamp)} · `
                          : ''}
                        {reel.commentCount} comment{reel.commentCount === 1 ? '' : 's'} in the last 50
                        {reel.lastSeenAt ? ` · last seen ${formatTime(reel.lastSeenAt)}` : ''}
                        {typeof reel.instagramMedia?.commentsCount === 'number'
                          ? ` · ${reel.instagramMedia.commentsCount} Instagram comments`
                          : ''}
                        {reel.latestComment
                          ? ` · latest: “${reel.latestComment.text.slice(0, 90)}”${reel.latestComment.username ? ` by @${reel.latestComment.username}` : ''}`
                          : ''}
                      </div>
                      {reel.instagramMedia?.permalink ? (
                        <div className="small resource-current">
                          <a href={reel.instagramMedia.permalink} target="_blank" rel="noreferrer">
                            Open this Reel/post on Instagram ↗
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`pill ${
                      reel.source === 'Dashboard'
                        ? 'pill-link_sent'
                        : reel.source === 'Not mapped'
                          ? 'pill-failed'
                          : reel.source === 'Env fallback'
                            ? 'pill-prompt_sent'
                            : 'pill-dry_run'
                    }`}
                  >
                    {reel.source}
                  </span>
                </div>

                {reel.effectiveUrl ? (
                  <div className="small resource-current">
                    Current link:{' '}
                    <a href={reel.effectiveUrl} target="_blank" rel="noreferrer">
                      {reel.effectiveUrl}
                    </a>
                  </div>
                ) : reel.source === 'Single DM_MESSAGE' ? (
                  <div className="small muted resource-current">
                    No per-Reel link yet — the single <code>DM_MESSAGE</code> is used.
                  </div>
                ) : (
                  <div className="small resource-current">
                    No resource mapped yet — comments on this Reel receive no prompt/link.
                  </div>
                )}

                <form action={saveMediaResource} className="resource-form">
                  <input type="hidden" name="mediaId" value={reel.mediaId} />
                  <label className="field" htmlFor={`label-${reel.mediaId}`}>
                    Resource name (optional)
                    <input
                      id={`label-${reel.mediaId}`}
                      name="label"
                      defaultValue={reel.dashboardResource?.label ?? ''}
                      placeholder="Free guide, template…"
                      maxLength={120}
                      disabled={!resourceWritesEnabled}
                    />
                  </label>
                  <label className="field" htmlFor={`url-${reel.mediaId}`}>
                    Resource URL for this Reel
                    <input
                      id={`url-${reel.mediaId}`}
                      name="url"
                      type="url"
                      defaultValue={reel.dashboardResource?.url ?? reel.envUrl ?? ''}
                      placeholder="https://example.com/this-reels-resource"
                      required
                      disabled={!resourceWritesEnabled}
                    />
                  </label>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={!resourceWritesEnabled}
                  >
                    {reel.dashboardResource ? 'Update resource' : 'Save resource'}
                  </button>
                </form>

                {reel.dashboardResource ? (
                  <form action={deleteMediaResource} className="resource-delete">
                    <input type="hidden" name="mediaId" value={reel.mediaId} />
                    <button className="link-button" type="submit" disabled={!resourceWritesEnabled}>
                      Remove dashboard resource
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Last 50 comments">
        {records.length === 0 ? (
          <div className="table-wrap empty">
            <strong>No comments yet</strong>
            Once your webhook is connected, comments appear here. To try it locally right now,
            run <code>npm run simulate -- &quot;LINK please!&quot;</code> in a second terminal —
            that sends a signed fake webhook to this app (labelled simulation, not a real
            Instagram event).
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Commenter</th>
                  <th>Comment</th>
                  <th>Reel / media ID</th>
                  <th>Trigger</th>
                  <th>Latest follow check</th>
                  <th>DM</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.commentId}>
                    <td className="nowrap muted">{formatTime(record.receivedAt)}</td>
                    <td className="nowrap">{record.username ? `@${record.username}` : '—'}</td>
                    <td className="comment-text">{record.text || <span className="muted">(empty)</span>}</td>
                    <td>{record.mediaId ? <code>{record.mediaId}</code> : <span className="muted">—</span>}</td>
                    <td>{record.matchedKeyword ? <code>{triggerLabel(record)}</code> : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`pill follow-${record.followStatus ?? 'not_checked'}`}>
                        {FOLLOW_LABEL[record.followStatus ?? 'not_checked']}
                      </span>
                    </td>
                    <td>
                      <span className={`pill pill-${record.dmStatus}`}>
                        {STATUS_LABEL[record.dmStatus]}
                      </span>
                    </td>
                    <td className="small muted">
                      {record.error
                        ? record.error
                        : record.dmMessageId
                          ? `Message ${record.dmMessageId}`
                          : `Comment ${record.commentId}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        Each triggering comment can receive one private-reply prompt, tied to that comment’s
        Reel/post. Follow status is checked before that prompt and again after the button tap;
        “Link sent” is shown only when the second check passes and Instagram confirms the message.
      </footer>
    </main>
  );
}
