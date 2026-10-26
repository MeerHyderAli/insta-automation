import { getConfig, getConfigStatus } from '../lib/config';
import { getStore } from '../lib/store';
import type { CommentRecord, DmStatus } from '../lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<DmStatus, string> = {
  sent: 'DM sent',
  failed: 'DM failed',
  not_matched: 'No keyword',
  dry_run: 'Dry run (not sent)',
  skipped_own_comment: 'Own comment',
  processing: 'Processing…',
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

  const sent = records.filter((record) => record.dmStatus === 'sent').length;
  const matched = records.filter((record) => record.matchedKeyword).length;
  const failed = records.filter((record) => record.dmStatus === 'failed').length;

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <div className="logo" aria-hidden="true">💬</div>
          <div>
            <div className="title">Comment-to-DM</div>
            <div className="subtitle">
              Keyword comments on your posts/Reels get one private reply with your link.
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
          <div className="stat-label">Keyword matches</div>
        </div>
        <div className="stat">
          <div className="stat-value">{sent}</div>
          <div className="stat-label">DMs confirmed sent</div>
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
              DM message + link {status.dmMessageConfigured ? 'configured' : 'missing'}{' '}
              <span className="muted">(<code>DM_MESSAGE</code>)</span>
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
          Keywords (case-insensitive, whole word):
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
                  <th>Keyword</th>
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
                    <td>{record.matchedKeyword ? <code>{record.matchedKeyword}</code> : <span className="muted">—</span>}</td>
                    <td>
                      <span className={`pill pill-${record.dmStatus}`}>
                        {STATUS_LABEL[record.dmStatus]}
                      </span>
                    </td>
                    <td className="small muted">
                      {record.dmStatus === 'sent' && record.dmMessageId
                        ? `Message ${record.dmMessageId}`
                        : record.error
                          ? record.error
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
        One private reply per comment is enforced twice: by Meta, and by this app claiming each
        comment id before sending. “DM sent” is only shown when the Instagram API confirmed the
        send with a message id.
      </footer>
    </main>
  );
}
