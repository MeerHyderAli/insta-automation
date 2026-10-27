import { getConfig, getConfigStatus } from '../lib/config';
import { getStore } from '../lib/store';
import type { CommentRecord, DmStatus, FollowStatus } from '../lib/types';

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

export default async function DashboardPage() {
  const config = getConfig();
  const status = getConfigStatus(config);

  let records: CommentRecord[] = [];
  let storeError: string | null = null;
  try {
    records = await getStore(config).list(50);
  } catch (error) {
    storeError = error instanceof Error ? error.message : 'Could not read the comment store';
  }

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

      <section className="card" aria-label="Setup checklist">
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
                !status.mediaLinksConfigValid ||
                (status.mediaLinkCount === 0 &&
                  !status.defaultLinkConfigured &&
                  status.dmMessageUsesLinkPlaceholder)
                  ? 'missing'
                  : status.mediaLinkCount > 0 || status.defaultLinkConfigured
                    ? 'ok'
                    : 'warn'
              }
            />
            <span>
              Per-Reel links: {status.mediaLinkCount} mapped
              {status.defaultLinkConfigured ? ', fallback link configured' : ', no fallback link'}{' '}
              <span className="muted">
                (<code>MEDIA_LINKS_JSON</code> / <code>DEFAULT_LINK_URL</code>)
              </span>
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
