import type { Db } from './db.js';
import type { Store } from './store.js';
import { errors } from '../lib/errors.js';
import type {
  AccountRecord,
  AccountStatus,
  AnalyticsSummary,
  JobRecord,
  MediaRecord,
  MemberRecord,
  OAuthStateRecord,
  PlanLimits,
  PlanRecord,
  ProfileRecord,
  ResourceRecord,
  RuleRecord,
  RunRecord,
  RunEventRecord,
  UsageSummary,
  WebhookEventRecord,
  WorkspaceRecord,
  WorkspaceRole,
  WorkspaceWithRole,
} from '../types/domain.js';
import { DEFAULT_PLAN_LIMITS } from '../types/domain.js';

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}
interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  limits: unknown;
}
interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan_id: string;
  timezone: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}
interface WorkspaceWithRoleRow extends WorkspaceRow {
  role: WorkspaceRole;
  plan_name: string | null;
  plan_description: string | null;
  plan_limits: unknown;
}
interface MemberRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: Date;
  email: string | null;
  full_name: string | null;
}
interface AccountRow {
  id: string;
  workspace_id: string;
  ig_user_id: string;
  meta_user_id: string | null;
  username: string;
  account_type: string | null;
  scopes: string[];
  token_ciphertext: string;
  token_iv: string;
  token_tag: string;
  token_key_version: number;
  token_expires_at: Date;
  status: AccountStatus;
  last_error_code: string | null;
  last_error_at: Date | null;
  webhook_subscribed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface MediaRow {
  id: string;
  workspace_id: string;
  account_id: string;
  ig_media_id: string;
  media_type: string | null;
  media_product_type: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  published_at: Date | null;
  fetched_at: Date;
}
interface ResourceRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  url: string;
  slug: string;
  click_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}
interface RuleRow {
  id: string;
  workspace_id: string;
  account_id: string;
  name: string;
  enabled: boolean;
  media_id: string | null;
  keywords: string[];
  public_reply_template: string | null;
  private_reply_template: string | null;
  resource_id: string | null;
  follow_gate: 'off' | 'instruction';
  priority: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}
interface EventRow {
  id: string;
  dedupe_key: string;
  workspace_id: string | null;
  account_id: string | null;
  ig_account_id: string | null;
  field: string;
  comment_id: string | null;
  media_id: string | null;
  commenter_igsid: string | null;
  commenter_username: string | null;
  comment_text: string | null;
  duplicate_count: number;
  status: WebhookEventRecord['status'];
  error_message: string | null;
  received_at: Date;
  processed_at: Date | null;
}
interface JobRow {
  id: string;
  webhook_event_id: string;
  workspace_id: string | null;
  account_id: string | null;
  status: JobRecord['status'];
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}
interface RunEventRow {
  id: string;
  run_id: string;
  level: 'info' | 'warn' | 'error';
  code: string | null;
  message: string;
  created_at: Date;
}
interface RunRow {
  id: string;
  workspace_id: string;
  account_id: string;
  webhook_event_id: string | null;
  rule_id: string | null;
  rule_name: string;
  comment_id: string;
  media_id: string | null;
  commenter_username: string | null;
  commenter_igsid: string | null;
  comment_text: string | null;
  matched_keyword: string | null;
  status: RunRecord['status'];
  skip_reason: string | null;
  public_reply_status: RunRecord['publicReplyStatus'];
  public_reply_id: string | null;
  public_reply_error: string | null;
  private_reply_status: RunRecord['privateReplyStatus'];
  private_reply_message_id: string | null;
  private_reply_error: string | null;
  attempts: number;
  last_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
  total_count?: number;
}

function normalizeLimits(value: unknown): PlanLimits {
  const raw = (value ?? {}) as Record<string, unknown>;
  const limits: PlanLimits = { ...DEFAULT_PLAN_LIMITS };
  for (const key of Object.keys(limits)) {
    const candidate = raw[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      limits[key] = Math.floor(candidate);
    }
  }
  return limits;
}

function mapProfile(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlan(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    limits: normalizeLimits(row.limits),
  };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    planId: row.plan_id,
    timezone: row.timezone,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: MemberRow): MemberRecord {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    email: row.email,
    fullName: row.full_name,
  };
}

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    igUserId: row.ig_user_id,
    metaUserId: row.meta_user_id,
    username: row.username,
    accountType: row.account_type,
    scopes: row.scopes ?? [],
    token: {
      ciphertext: row.token_ciphertext,
      iv: row.token_iv,
      tag: row.token_tag,
      keyVersion: row.token_key_version,
    },
    tokenExpiresAt: row.token_expires_at,
    status: row.status,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    webhookSubscribedAt: row.webhook_subscribed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    igMediaId: row.ig_media_id,
    mediaType: row.media_type,
    mediaProductType: row.media_product_type,
    caption: row.caption,
    permalink: row.permalink,
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
  };
}

function mapResource(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    url: row.url,
    slug: row.slug,
    clickCount: row.click_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRule(row: RuleRow): RuleRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    name: row.name,
    enabled: row.enabled,
    mediaId: row.media_id,
    keywords: row.keywords,
    publicReplyTemplate: row.public_reply_template,
    privateReplyTemplate: row.private_reply_template,
    resourceId: row.resource_id,
    followGate: row.follow_gate,
    priority: row.priority,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): WebhookEventRecord {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    igAccountId: row.ig_account_id,
    field: row.field,
    commentId: row.comment_id,
    mediaId: row.media_id,
    commenterIgsid: row.commenter_igsid,
    commenterUsername: row.commenter_username,
    commentText: row.comment_text,
    duplicateCount: row.duplicate_count,
    status: row.status,
    errorMessage: row.error_message,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
  };
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    webhookEventId: row.webhook_event_id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    webhookEventId: row.webhook_event_id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    commentId: row.comment_id,
    mediaId: row.media_id,
    commenterUsername: row.commenter_username,
    commenterIgsid: row.commenter_igsid,
    commentText: row.comment_text,
    matchedKeyword: row.matched_keyword,
    status: row.status,
    skipReason: row.skip_reason,
    publicReplyStatus: row.public_reply_status,
    publicReplyId: row.public_reply_id,
    publicReplyError: row.public_reply_error,
    privateReplyStatus: row.private_reply_status,
    privateReplyMessageId: row.private_reply_message_id,
    privateReplyError: row.private_reply_error,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

const ACCOUNT_COLUMNS = `id, workspace_id, ig_user_id, meta_user_id, username, account_type, scopes,
  token_ciphertext, token_iv, token_tag, token_key_version, token_expires_at, status,
  last_error_code, last_error_at, webhook_subscribed_at, created_at, updated_at`;

export class PgStore implements Store {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.query('select 1');
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------
  async upsertProfile(input: {
    id: string;
    email: string | null;
    fullName?: string | null;
  }): Promise<ProfileRecord> {
    const result = await this.db.query<ProfileRow>(
      `insert into public.profiles (id, email, full_name)
       values ($1, $2, $3)
       on conflict (id) do update set
         email = coalesce(excluded.email, public.profiles.email),
         full_name = coalesce(excluded.full_name, public.profiles.full_name)
       returning *`,
      [input.id, input.email, input.fullName ?? null],
    );
    const row = first(result.rows);
    if (!row) throw errors.internal('Profile upsert returned no row.');
    return mapProfile(row);
  }

  async updateProfile(
    id: string,
    patch: { fullName?: string | null; avatarUrl?: string | null },
  ): Promise<ProfileRecord> {
    const result = await this.db.query<ProfileRow>(
      `update public.profiles
       set full_name = case when $2::boolean then $3 else full_name end,
           avatar_url = case when $4::boolean then $5 else avatar_url end,
           updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        patch.fullName !== undefined,
        patch.fullName ?? null,
        patch.avatarUrl !== undefined,
        patch.avatarUrl ?? null,
      ],
    );
    const row = first(result.rows);
    if (!row) {
      await this.upsertProfile({ id, email: null });
      return this.updateProfile(id, patch);
    }
    return mapProfile(row);
  }

  async getProfile(id: string): Promise<ProfileRecord | null> {
    const result = await this.db.query<ProfileRow>('select * from public.profiles where id = $1', [
      id,
    ]);
    const row = first(result.rows);
    return row ? mapProfile(row) : null;
  }

  async findProfileByEmail(email: string): Promise<ProfileRecord | null> {
    const result = await this.db.query<ProfileRow>(
      'select * from public.profiles where lower(email) = lower($1) limit 1',
      [email],
    );
    const row = first(result.rows);
    return row ? mapProfile(row) : null;
  }

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------
  async getPlan(id: string): Promise<PlanRecord | null> {
    const result = await this.db.query<PlanRow>('select * from public.plans where id = $1', [id]);
    const row = first(result.rows);
    return row ? mapPlan(row) : null;
  }

  async listPlans(): Promise<PlanRecord[]> {
    const result = await this.db.query<PlanRow>('select * from public.plans order by name');
    return result.rows.map(mapPlan);
  }

  // -------------------------------------------------------------------------
  // Workspaces and members
  // -------------------------------------------------------------------------
  async createWorkspace(input: {
    name: string;
    slug: string;
    planId: string;
    timezone: string;
    createdBy: string;
  }): Promise<WorkspaceRecord> {
    return this.db.withTransaction(async (tx) => {
      const created = await tx.query<WorkspaceRow>(
        `insert into public.workspaces (name, slug, plan_id, timezone, created_by)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [input.name, input.slug, input.planId, input.timezone, input.createdBy],
      );
      const row = first(created.rows);
      if (!row) throw errors.internal('Workspace insert returned no row.');
      await tx.query(
        `insert into public.workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'owner')`,
        [row.id, input.createdBy],
      );
      return mapWorkspace(row);
    });
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord | null> {
    const result = await this.db.query<WorkspaceRow>(
      'select * from public.workspaces where id = $1',
      [id],
    );
    const row = first(result.rows);
    return row ? mapWorkspace(row) : null;
  }

  async getWorkspaceForUser(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: WorkspaceRecord; role: WorkspaceRole } | null> {
    const result = await this.db.query<WorkspaceRow & { role: WorkspaceRole }>(
      `select w.*, m.role
       from public.workspaces w
       join public.workspace_members m on m.workspace_id = w.id
       where w.id = $1 and m.user_id = $2`,
      [workspaceId, userId],
    );
    const row = first(result.rows);
    return row ? { workspace: mapWorkspace(row), role: row.role } : null;
  }

  async listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]> {
    const result = await this.db.query<WorkspaceWithRoleRow>(
      `select w.*, m.role,
              p.name as plan_name, p.description as plan_description, p.limits as plan_limits
       from public.workspaces w
       join public.workspace_members m on m.workspace_id = w.id
       left join public.plans p on p.id = w.plan_id
       where m.user_id = $1
       order by w.created_at asc`,
      [userId],
    );
    return result.rows.map((row) => ({
      ...mapWorkspace(row),
      role: row.role,
      plan: row.plan_name
        ? {
            id: row.plan_id,
            name: row.plan_name,
            description: row.plan_description,
            limits: normalizeLimits(row.plan_limits),
          }
        : null,
    }));
  }

  async updateWorkspace(
    id: string,
    patch: { name?: string; timezone?: string },
  ): Promise<WorkspaceRecord> {
    const result = await this.db.query<WorkspaceRow>(
      `update public.workspaces
       set name = coalesce($2, name), timezone = coalesce($3, timezone)
       where id = $1
       returning *`,
      [id, patch.name ?? null, patch.timezone ?? null],
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Workspace not found.');
    return mapWorkspace(row);
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.db.query('delete from public.workspaces where id = $1', [id]);
  }

  async listMembers(workspaceId: string): Promise<MemberRecord[]> {
    const result = await this.db.query<MemberRow>(
      `select m.workspace_id, m.user_id, m.role, m.created_at, p.email, p.full_name
       from public.workspace_members m
       left join public.profiles p on p.id = m.user_id
       where m.workspace_id = $1
       order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at`,
      [workspaceId],
    );
    return result.rows.map(mapMember);
  }

  async getMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: WorkspaceRole } | null> {
    const result = await this.db.query<{ role: WorkspaceRole }>(
      'select role from public.workspace_members where workspace_id = $1 and user_id = $2',
      [workspaceId, userId],
    );
    const row = first(result.rows);
    return row ? { role: row.role } : null;
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<MemberRecord> {
    await this.db.query(
      `insert into public.workspace_members (workspace_id, user_id, role)
       values ($1, $2, $3)
       on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [workspaceId, userId, role],
    );
    const result = await this.db.query<MemberRow>(
      `select m.workspace_id, m.user_id, m.role, m.created_at, p.email, p.full_name
       from public.workspace_members m
       left join public.profiles p on p.id = m.user_id
       where m.workspace_id = $1 and m.user_id = $2`,
      [workspaceId, userId],
    );
    const row = first(result.rows);
    if (!row) throw errors.internal('Member insert returned no row.');
    return mapMember(row);
  }

  async updateMemberRole(
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ): Promise<void> {
    await this.db.query(
      'update public.workspace_members set role = $3 where workspace_id = $1 and user_id = $2',
      [workspaceId, userId, role],
    );
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.db.query(
      'delete from public.workspace_members where workspace_id = $1 and user_id = $2 and role <> $3',
      [workspaceId, userId, 'owner'],
    );
  }

  async countMembers(workspaceId: string): Promise<number> {
    return this.count(
      'select count(*)::int as count from public.workspace_members where workspace_id = $1',
      [workspaceId],
    );
  }

  // -------------------------------------------------------------------------
  // Instagram accounts
  // -------------------------------------------------------------------------
  async listAccounts(workspaceId: string): Promise<AccountRecord[]> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts
       where workspace_id = $1 order by created_at asc`,
      [workspaceId],
    );
    return result.rows.map(mapAccount);
  }

  async getAccount(workspaceId: string, accountId: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts
       where workspace_id = $1 and id = $2`,
      [workspaceId, accountId],
    );
    const row = first(result.rows);
    return row ? mapAccount(row) : null;
  }

  async getAccountById(accountId: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts where id = $1`,
      [accountId],
    );
    const row = first(result.rows);
    return row ? mapAccount(row) : null;
  }

  async getAccountsByMetaUserId(metaUserId: string): Promise<AccountRecord[]> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts where meta_user_id = $1`,
      [metaUserId],
    );
    return result.rows.map(mapAccount);
  }

  async getAccountByIgUserId(igUserId: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts where ig_user_id = $1`,
      [igUserId],
    );
    const row = first(result.rows);
    return row ? mapAccount(row) : null;
  }

  async upsertAccount(input: {
    id: string;
    workspaceId: string;
    igUserId: string;
    metaUserId: string | null;
    username: string;
    accountType: string | null;
    scopes: string[];
    token: { ciphertext: string; iv: string; tag: string; keyVersion: number };
    tokenExpiresAt: Date;
  }): Promise<{ account: AccountRecord; created: boolean }> {
    return this.db.withTransaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [input.igUserId]);
      const existing = first(
        (
          await tx.query<AccountRow>(
            `select ${ACCOUNT_COLUMNS} from public.instagram_accounts where ig_user_id = $1`,
            [input.igUserId],
          )
        ).rows,
      );
      if (existing && existing.workspace_id !== input.workspaceId) {
        throw errors.conflict(
          'This Instagram account is already connected to another workspace. Disconnect it there before connecting it here.',
        );
      }
      if (existing) {
        if (existing.id !== input.id) {
          throw errors.conflict(
            'The account connection changed while completing OAuth. Try again.',
          );
        }
        const updated = await tx.query<AccountRow>(
          `update public.instagram_accounts
           set username = $2, account_type = $3, scopes = $4,
               meta_user_id = $5,
               token_ciphertext = $6, token_iv = $7, token_tag = $8, token_key_version = $9,
               token_expires_at = $10, status = 'connected', last_error_code = null,
               last_error_at = null, disconnected_at = null,
               webhook_subscribed_at = null
           where id = $1
           returning ${ACCOUNT_COLUMNS}`,
          [
            existing.id,
            input.username,
            input.accountType,
            input.scopes,
            input.metaUserId,
            input.token.ciphertext,
            input.token.iv,
            input.token.tag,
            input.token.keyVersion,
            input.tokenExpiresAt,
          ],
        );
        const row = first(updated.rows);
        if (!row) throw errors.internal('Account update returned no row.');
        return { account: mapAccount(row), created: false };
      }
      const inserted = await tx.query<AccountRow>(
        `insert into public.instagram_accounts (
           id, workspace_id, ig_user_id, meta_user_id, username, account_type, scopes,
           token_ciphertext, token_iv, token_tag, token_key_version, token_expires_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning ${ACCOUNT_COLUMNS}`,
        [
          input.id,
          input.workspaceId,
          input.igUserId,
          input.metaUserId,
          input.username,
          input.accountType,
          input.scopes,
          input.token.ciphertext,
          input.token.iv,
          input.token.tag,
          input.token.keyVersion,
          input.tokenExpiresAt,
        ],
      );
      const row = first(inserted.rows);
      if (!row) throw errors.internal('Account insert returned no row.');
      return { account: mapAccount(row), created: true };
    });
  }

  async updateAccountToken(
    accountId: string,
    token: { ciphertext: string; iv: string; tag: string; keyVersion: number },
    expiresAt: Date,
  ): Promise<AccountRecord> {
    const result = await this.db.query<AccountRow>(
      `update public.instagram_accounts
       set token_ciphertext = $2, token_iv = $3, token_tag = $4, token_key_version = $5,
           token_expires_at = $6, status = 'connected', last_error_code = null,
           last_error_at = null, disconnected_at = null
       where id = $1
       returning ${ACCOUNT_COLUMNS}`,
      [accountId, token.ciphertext, token.iv, token.tag, token.keyVersion, expiresAt],
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Instagram account not found.');
    return mapAccount(row);
  }

  async updateAccountStatus(
    accountId: string,
    status: AccountStatus,
    errorCode: string | null = null,
  ): Promise<AccountRecord> {
    const result = await this.db.query<AccountRow>(
      `update public.instagram_accounts
       set status = $2,
           last_error_code = $3::text,
           last_error_at = case when $3::text is null then null else now() end
       where id = $1
       returning ${ACCOUNT_COLUMNS}`,
      [accountId, status, errorCode],
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Instagram account not found.');
    return mapAccount(row);
  }

  async markWebhookSubscribed(accountId: string): Promise<AccountRecord> {
    const result = await this.db.query<AccountRow>(
      `update public.instagram_accounts
       set webhook_subscribed_at = now(), last_error_code = null, last_error_at = null
       where id = $1
       returning ${ACCOUNT_COLUMNS}`,
      [accountId],
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Instagram account not found.');
    return mapAccount(row);
  }

  async disconnectAccount(accountId: string): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `update public.instagram_accounts
         set status = 'disconnected', scopes = '{}',
             token_ciphertext = '', token_iv = '', token_tag = '',
             token_expires_at = now(), disconnected_at = now()
         where id = $1`,
        [accountId],
      );
      await tx.query('update public.automation_rules set enabled = false where account_id = $1', [
        accountId,
      ]);
    });
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.db.query('delete from public.instagram_accounts where id = $1', [accountId]);
  }

  async listAccountsNeedingRefresh(before: Date): Promise<AccountRecord[]> {
    const result = await this.db.query<AccountRow>(
      `select ${ACCOUNT_COLUMNS} from public.instagram_accounts
       where status = 'connected' and token_expires_at < $1
       order by token_expires_at asc
       limit 100`,
      [before],
    );
    return result.rows.map(mapAccount);
  }

  async countAccounts(workspaceId: string): Promise<number> {
    return this.count(
      `select count(*)::int as count from public.instagram_accounts
       where workspace_id = $1 and status <> 'disconnected'`,
      [workspaceId],
    );
  }

  // -------------------------------------------------------------------------
  // Media cache
  // -------------------------------------------------------------------------
  async replaceMedia(
    workspaceId: string,
    accountId: string,
    items: {
      igMediaId: string;
      mediaType: string | null;
      mediaProductType: string | null;
      caption: string | null;
      permalink: string | null;
      thumbnailUrl: string | null;
      publishedAt: Date | null;
    }[],
  ): Promise<MediaRecord[]> {
    return this.db.withTransaction(async (tx) => {
      for (const item of items) {
        await tx.query(
          `insert into public.instagram_media (
             workspace_id, account_id, ig_media_id, media_type, media_product_type,
             caption, permalink, thumbnail_url, published_at, fetched_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           on conflict (account_id, ig_media_id) do update set
             media_type = excluded.media_type,
             media_product_type = excluded.media_product_type,
             caption = excluded.caption,
             permalink = excluded.permalink,
             thumbnail_url = excluded.thumbnail_url,
             published_at = excluded.published_at,
             fetched_at = now()`,
          [
            workspaceId,
            accountId,
            item.igMediaId,
            item.mediaType,
            item.mediaProductType,
            item.caption,
            item.permalink,
            item.thumbnailUrl,
            item.publishedAt,
          ],
        );
      }
      await tx.query(
        `delete from public.instagram_media
         where account_id = $1 and not (ig_media_id = any($2::text[]))`,
        [accountId, items.map((item) => item.igMediaId)],
      );
      const result = await tx.query<MediaRow>(
        `select * from public.instagram_media where account_id = $1 order by published_at desc nulls last`,
        [accountId],
      );
      return result.rows.map(mapMedia);
    });
  }

  async listMedia(workspaceId: string, accountId: string): Promise<MediaRecord[]> {
    const result = await this.db.query<MediaRow>(
      `select * from public.instagram_media
       where workspace_id = $1 and account_id = $2
       order by published_at desc nulls last`,
      [workspaceId, accountId],
    );
    return result.rows.map(mapMedia);
  }

  async getMedia(accountId: string, igMediaId: string): Promise<MediaRecord | null> {
    const result = await this.db.query<MediaRow>(
      'select * from public.instagram_media where account_id = $1 and ig_media_id = $2',
      [accountId, igMediaId],
    );
    const row = first(result.rows);
    return row ? mapMedia(row) : null;
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------
  async listRules(workspaceId: string): Promise<RuleRecord[]> {
    const result = await this.db.query<RuleRow>(
      `select * from public.automation_rules where workspace_id = $1
       order by priority asc, created_at asc`,
      [workspaceId],
    );
    return result.rows.map(mapRule);
  }

  async getRule(workspaceId: string, ruleId: string): Promise<RuleRecord | null> {
    const result = await this.db.query<RuleRow>(
      'select * from public.automation_rules where workspace_id = $1 and id = $2',
      [workspaceId, ruleId],
    );
    const row = first(result.rows);
    return row ? mapRule(row) : null;
  }

  async createRule(input: {
    workspaceId: string;
    accountId: string;
    name: string;
    enabled: boolean;
    mediaId: string | null;
    keywords: string[];
    publicReplyTemplate: string | null;
    privateReplyTemplate: string | null;
    resourceId: string | null;
    followGate: 'off' | 'instruction';
    priority: number;
    createdBy: string;
  }): Promise<RuleRecord> {
    const result = await this.db.query<RuleRow>(
      `insert into public.automation_rules (
         workspace_id, account_id, name, enabled, media_id, keywords,
         public_reply_template, private_reply_template, resource_id, follow_gate,
         priority, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        input.workspaceId,
        input.accountId,
        input.name,
        input.enabled,
        input.mediaId,
        input.keywords,
        input.publicReplyTemplate,
        input.privateReplyTemplate,
        input.resourceId,
        input.followGate,
        input.priority,
        input.createdBy,
      ],
    );
    const row = first(result.rows);
    if (!row) throw errors.internal('Rule insert returned no row.');
    return mapRule(row);
  }

  async updateRule(
    workspaceId: string,
    ruleId: string,
    patch: Partial<{
      name: string;
      enabled: boolean;
      mediaId: string | null;
      keywords: string[];
      publicReplyTemplate: string | null;
      privateReplyTemplate: string | null;
      resourceId: string | null;
      followGate: 'off' | 'instruction';
      priority: number;
    }>,
  ): Promise<RuleRecord> {
    const mapping: Array<[keyof typeof patch, string]> = [
      ['name', 'name'],
      ['enabled', 'enabled'],
      ['mediaId', 'media_id'],
      ['keywords', 'keywords'],
      ['publicReplyTemplate', 'public_reply_template'],
      ['privateReplyTemplate', 'private_reply_template'],
      ['resourceId', 'resource_id'],
      ['followGate', 'follow_gate'],
      ['priority', 'priority'],
    ];
    const values: unknown[] = [workspaceId, ruleId];
    const sets: string[] = [];
    for (const [key, column] of mapping) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        values.push(patch[key] ?? null);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) {
      const existing = await this.getRule(workspaceId, ruleId);
      if (!existing) throw errors.notFound('Automation not found.');
      return existing;
    }
    const result = await this.db.query<RuleRow>(
      `update public.automation_rules set ${sets.join(', ')}
       where workspace_id = $1 and id = $2
       returning *`,
      values,
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Automation not found.');
    return mapRule(row);
  }

  async deleteRule(workspaceId: string, ruleId: string): Promise<void> {
    await this.db.query('delete from public.automation_rules where workspace_id = $1 and id = $2', [
      workspaceId,
      ruleId,
    ]);
  }

  async countRules(workspaceId: string): Promise<number> {
    return this.count(
      'select count(*)::int as count from public.automation_rules where workspace_id = $1',
      [workspaceId],
    );
  }

  async getEnabledRulesForAccount(accountId: string): Promise<RuleRecord[]> {
    const result = await this.db.query<RuleRow>(
      `select * from public.automation_rules
       where account_id = $1 and enabled = true
       order by priority asc, created_at asc`,
      [accountId],
    );
    return result.rows.map(mapRule);
  }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  async listResources(workspaceId: string): Promise<ResourceRecord[]> {
    const result = await this.db.query<ResourceRow>(
      'select * from public.resources where workspace_id = $1 order by created_at desc',
      [workspaceId],
    );
    return result.rows.map(mapResource);
  }

  async getResource(workspaceId: string, resourceId: string): Promise<ResourceRecord | null> {
    const result = await this.db.query<ResourceRow>(
      'select * from public.resources where workspace_id = $1 and id = $2',
      [workspaceId, resourceId],
    );
    const row = first(result.rows);
    return row ? mapResource(row) : null;
  }

  async getResourceBySlug(slug: string): Promise<ResourceRecord | null> {
    const result = await this.db.query<ResourceRow>(
      'select * from public.resources where slug = $1',
      [slug],
    );
    const row = first(result.rows);
    return row ? mapResource(row) : null;
  }

  async createResource(input: {
    workspaceId: string;
    title: string;
    description: string | null;
    url: string;
    slug: string;
    createdBy: string;
  }): Promise<ResourceRecord> {
    const result = await this.db.query<ResourceRow>(
      `insert into public.resources (workspace_id, title, description, url, slug, created_by)
       values ($1,$2,$3,$4,$5,$6)
       returning *`,
      [input.workspaceId, input.title, input.description, input.url, input.slug, input.createdBy],
    );
    const row = first(result.rows);
    if (!row) throw errors.internal('Resource insert returned no row.');
    return mapResource(row);
  }

  async updateResource(
    workspaceId: string,
    resourceId: string,
    patch: { title?: string; description?: string | null; url?: string },
  ): Promise<ResourceRecord> {
    const values: unknown[] = [workspaceId, resourceId];
    const sets: string[] = [];
    for (const [key, column] of [
      ['title', 'title'],
      ['description', 'description'],
      ['url', 'url'],
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        values.push(patch[key] ?? null);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) {
      const existing = await this.getResource(workspaceId, resourceId);
      if (!existing) throw errors.notFound('Resource not found.');
      return existing;
    }
    const result = await this.db.query<ResourceRow>(
      `update public.resources set ${sets.join(', ')}
       where workspace_id = $1 and id = $2 returning *`,
      values,
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Resource not found.');
    return mapResource(row);
  }

  async deleteResource(workspaceId: string, resourceId: string): Promise<void> {
    await this.db.query('delete from public.resources where workspace_id = $1 and id = $2', [
      workspaceId,
      resourceId,
    ]);
  }

  async countResources(workspaceId: string): Promise<number> {
    return this.count(
      'select count(*)::int as count from public.resources where workspace_id = $1',
      [workspaceId],
    );
  }

  async recordResourceClick(resource: ResourceRecord, userAgent: string | null): Promise<void> {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `insert into public.resource_clicks (workspace_id, resource_id, user_agent)
         values ($1, $2, $3)`,
        [resource.workspaceId, resource.id, userAgent?.slice(0, 200) ?? null],
      );
      await tx.query('update public.resources set click_count = click_count + 1 where id = $1', [
        resource.id,
      ]);
    });
  }

  async countResourceClicksSince(workspaceId: string, since: Date): Promise<number> {
    return this.count(
      'select count(*)::int as count from public.resource_clicks where workspace_id = $1 and clicked_at >= $2',
      [workspaceId, since],
    );
  }

  // -------------------------------------------------------------------------
  // OAuth state
  // -------------------------------------------------------------------------
  async createOAuthState(input: {
    stateHash: string;
    workspaceId: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `insert into public.oauth_states (state_hash, workspace_id, user_id, expires_at)
       values ($1, $2, $3, $4)`,
      [input.stateHash, input.workspaceId, input.userId, input.expiresAt],
    );
  }

  async consumeOAuthState(stateHash: string): Promise<OAuthStateRecord | null> {
    const result = await this.db.query<{
      workspace_id: string;
      user_id: string;
      expires_at: Date;
    }>(
      `update public.oauth_states set consumed_at = now()
       where state_hash = $1 and consumed_at is null and expires_at > now()
       returning workspace_id, user_id, expires_at`,
      [stateHash],
    );
    const row = first(result.rows);
    return row
      ? { workspaceId: row.workspace_id, userId: row.user_id, expiresAt: row.expires_at }
      : null;
  }

  async deleteExpiredOAuthStates(): Promise<void> {
    await this.db.query('select app.cleanup_oauth_states()');
  }

  // -------------------------------------------------------------------------
  // Webhook events + jobs
  // -------------------------------------------------------------------------
  async recordWebhookEvent(input: {
    dedupeKey: string;
    workspaceId: string | null;
    accountId: string | null;
    igAccountId: string | null;
    field: string;
    commentId: string | null;
    mediaId: string | null;
    commenterIgsid: string | null;
    commenterUsername: string | null;
    commentText: string | null;
    payload: unknown;
  }): Promise<{ event: WebhookEventRecord; duplicate: boolean }> {
    const result = await this.db.query<EventRow & { was_inserted: boolean }>(
      `insert into public.webhook_events (
         dedupe_key, workspace_id, account_id, ig_account_id, field, comment_id,
         media_id, commenter_igsid, commenter_username, comment_text, payload
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (dedupe_key) do update
         set duplicate_count = public.webhook_events.duplicate_count + 1
       returning *, (xmax = 0) as was_inserted`,
      [
        input.dedupeKey,
        input.workspaceId,
        input.accountId,
        input.igAccountId,
        input.field,
        input.commentId,
        input.mediaId,
        input.commenterIgsid,
        input.commenterUsername,
        input.commentText,
        input.payload === null || input.payload === undefined
          ? null
          : JSON.stringify(input.payload),
      ],
    );
    const row = first(result.rows);
    if (!row) throw errors.internal('Webhook event insert returned no row.');
    return { event: mapEvent(row), duplicate: !row.was_inserted };
  }

  async updateWebhookEvent(
    id: string,
    status: WebhookEventRecord['status'],
    errorMessage: string | null = null,
  ): Promise<void> {
    await this.db.query(
      `update public.webhook_events
       set status = $2, error_message = $3,
           processed_at = case when $2 in ('processed','ignored','unsupported','failed') then now() else null end
       where id = $1`,
      [id, status, errorMessage?.slice(0, 500) ?? null],
    );
  }

  async getWebhookEvent(id: string): Promise<WebhookEventRecord | null> {
    const result = await this.db.query<EventRow>(
      'select * from public.webhook_events where id = $1',
      [id],
    );
    const row = first(result.rows);
    return row ? mapEvent(row) : null;
  }

  async enqueueJob(input: {
    webhookEventId: string;
    workspaceId: string | null;
    accountId: string | null;
    maxAttempts: number;
  }): Promise<void> {
    await this.db.query(
      `insert into public.automation_jobs (webhook_event_id, workspace_id, account_id, max_attempts)
       values ($1, $2, $3, $4)
       on conflict (webhook_event_id) do nothing`,
      [input.webhookEventId, input.workspaceId, input.accountId, input.maxAttempts],
    );
  }

  async claimJob(workerId: string): Promise<JobRecord | null> {
    const result = await this.db.query<JobRow>(
      `with candidate as (
         select id from public.automation_jobs
         where (status = 'queued' and run_after <= now())
            or (status = 'running' and locked_at < now() - interval '10 minutes')
         order by run_after asc
         limit 1
         for update skip locked
       )
       update public.automation_jobs j
       set status = 'running', locked_at = now(), locked_by = $1,
           attempts = j.attempts + 1, updated_at = now()
       from candidate c
       where j.id = c.id
       returning j.*`,
      [workerId],
    );
    const row = first(result.rows);
    return row ? mapJob(row) : null;
  }

  async completeJob(jobId: string): Promise<void> {
    await this.db.query(
      `update public.automation_jobs set status = 'completed', locked_at = null, last_error = null
       where id = $1`,
      [jobId],
    );
  }

  async rescheduleJob(jobId: string, runAfter: Date, error: string): Promise<'retry' | 'dead'> {
    const result = await this.db.query<{ attempts: number; max_attempts: number }>(
      `update public.automation_jobs
       set status = case when attempts >= max_attempts then 'dead' else 'queued' end,
           run_after = $2, locked_at = null, locked_by = null, last_error = $3
       where id = $1
       returning attempts, max_attempts`,
      [jobId, runAfter, error.slice(0, 500)],
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Job not found.');
    return row.attempts >= row.max_attempts ? 'dead' : 'retry';
  }

  async failJob(jobId: string, error: string): Promise<void> {
    await this.db.query(
      `update public.automation_jobs
       set status = 'dead', locked_at = null, locked_by = null, last_error = $2
       where id = $1`,
      [jobId, error.slice(0, 500)],
    );
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------
  async createOrGetRun(input: {
    workspaceId: string;
    accountId: string;
    webhookEventId: string;
    ruleId: string;
    ruleName: string;
    commentId: string;
    mediaId: string | null;
    commenterUsername: string | null;
    commenterIgsid: string | null;
    commentText: string | null;
    matchedKeyword: string;
  }): Promise<{ run: RunRecord; created: boolean }> {
    return this.db.withTransaction(async (tx) => {
      const inserted = await tx.query<RunRow>(
        `insert into public.automation_runs (
           workspace_id, account_id, webhook_event_id, rule_id, rule_name, comment_id,
           media_id, commenter_username, commenter_igsid, comment_text, matched_keyword,
           public_reply_status, private_reply_status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'skipped','skipped')
         on conflict (account_id, comment_id) do nothing
         returning *`,
        [
          input.workspaceId,
          input.accountId,
          input.webhookEventId,
          input.ruleId,
          input.ruleName,
          input.commentId,
          input.mediaId,
          input.commenterUsername,
          input.commenterIgsid,
          input.commentText,
          input.matchedKeyword,
        ],
      );
      const insertedRow = first(inserted.rows);
      if (insertedRow) return { run: mapRun(insertedRow), created: true };
      const existing = await tx.query<RunRow>(
        'select * from public.automation_runs where account_id = $1 and comment_id = $2',
        [input.accountId, input.commentId],
      );
      const existingRow = first(existing.rows);
      if (!existingRow) throw errors.internal('Run conflict without an existing row.');
      return { run: mapRun(existingRow), created: false };
    });
  }

  async updateRun(
    runId: string,
    patch: {
      status?: RunRecord['status'];
      skipReason?: string | null;
      publicReplyStatus?: RunRecord['publicReplyStatus'];
      publicReplyId?: string | null;
      publicReplyError?: string | null;
      privateReplyStatus?: RunRecord['privateReplyStatus'];
      privateReplyMessageId?: string | null;
      privateReplyError?: string | null;
      incrementAttempts?: boolean;
      lastAttemptAt?: Date | null;
    },
  ): Promise<RunRecord> {
    const mapping: Array<[keyof typeof patch, string]> = [
      ['status', 'status'],
      ['skipReason', 'skip_reason'],
      ['publicReplyStatus', 'public_reply_status'],
      ['publicReplyId', 'public_reply_id'],
      ['publicReplyError', 'public_reply_error'],
      ['privateReplyStatus', 'private_reply_status'],
      ['privateReplyMessageId', 'private_reply_message_id'],
      ['privateReplyError', 'private_reply_error'],
      ['lastAttemptAt', 'last_attempt_at'],
    ];
    const values: unknown[] = [runId];
    const sets: string[] = [];
    for (const [key, column] of mapping) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        values.push(patch[key] ?? null);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (patch.incrementAttempts) sets.push('attempts = attempts + 1');
    if (sets.length === 0) {
      const existing = await this.db.query<RunRow>(
        'select * from public.automation_runs where id = $1',
        [runId],
      );
      const row = first(existing.rows);
      if (!row) throw errors.notFound('Run not found.');
      return mapRun(row);
    }
    const result = await this.db.query<RunRow>(
      `update public.automation_runs set ${sets.join(', ')} where id = $1 returning *`,
      values,
    );
    const row = first(result.rows);
    if (!row) throw errors.notFound('Run not found.');
    return mapRun(row);
  }

  async getRun(workspaceId: string, runId: string): Promise<RunRecord | null> {
    const result = await this.db.query<RunRow>(
      'select * from public.automation_runs where workspace_id = $1 and id = $2',
      [workspaceId, runId],
    );
    const row = first(result.rows);
    return row ? mapRun(row) : null;
  }

  async getRunByComment(accountId: string, commentId: string): Promise<RunRecord | null> {
    const result = await this.db.query<RunRow>(
      'select * from public.automation_runs where account_id = $1 and comment_id = $2',
      [accountId, commentId],
    );
    const row = first(result.rows);
    return row ? mapRun(row) : null;
  }

  async getRunForEvent(webhookEventId: string): Promise<RunRecord | null> {
    const result = await this.db.query<RunRow>(
      'select * from public.automation_runs where webhook_event_id = $1 limit 1',
      [webhookEventId],
    );
    const row = first(result.rows);
    return row ? mapRun(row) : null;
  }

  async listRuns(
    workspaceId: string,
    filter: {
      status?: RunRecord['status'];
      accountId?: string;
      ruleId?: string;
      limit: number;
      offset: number;
    },
  ): Promise<{ items: RunRecord[]; total: number }> {
    const values: unknown[] = [workspaceId];
    const conditions = ['workspace_id = $1'];
    if (filter.status) {
      values.push(filter.status);
      conditions.push(`status = $${values.length}`);
    }
    if (filter.accountId) {
      values.push(filter.accountId);
      conditions.push(`account_id = $${values.length}`);
    }
    if (filter.ruleId) {
      values.push(filter.ruleId);
      conditions.push(`rule_id = $${values.length}`);
    }
    values.push(filter.limit, filter.offset);
    const result = await this.db.query<RunRow>(
      `select *, count(*) over()::int as total_count
       from public.automation_runs
       where ${conditions.join(' and ')}
       order by created_at desc
       limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    const total = result.rows[0]?.total_count ?? 0;
    return { items: result.rows.map(mapRun), total };
  }

  async addRunEvent(input: {
    runId: string;
    workspaceId: string;
    level: 'info' | 'warn' | 'error';
    code: string | null;
    message: string;
  }): Promise<void> {
    await this.db.query(
      `insert into public.automation_run_events (run_id, workspace_id, level, code, message)
       values ($1, $2, $3, $4, $5)`,
      [input.runId, input.workspaceId, input.level, input.code, input.message.slice(0, 1000)],
    );
  }

  async listRunEvents(runId: string): Promise<RunEventRecord[]> {
    const result = await this.db.query<RunEventRow>(
      `select * from public.automation_run_events where run_id = $1 order by created_at asc`,
      [runId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      level: row.level,
      code: row.code,
      message: row.message,
      createdAt: row.created_at,
    }));
  }

  async countPrivateRepliesSince(accountId: string, since: Date): Promise<number> {
    return this.count(
      `select count(*)::int as count from public.automation_runs
       where account_id = $1 and private_reply_status in ('sending','sent','unknown')
         and updated_at >= $2`,
      [accountId, since],
    );
  }

  // -------------------------------------------------------------------------
  // Usage + analytics
  // -------------------------------------------------------------------------
  async incrementUsage(
    workspaceId: string,
    metric: string,
    amount: number,
    limit: number | null = null,
  ): Promise<number | null> {
    const result = await this.db.query<{ quantity: number | null }>(
      'select app.increment_usage($1, $2, $3, $4) as quantity',
      [workspaceId, metric, amount, limit],
    );
    const row = first(result.rows);
    const quantity = row?.quantity;
    return quantity === null || quantity === undefined ? null : Number(quantity);
  }

  async releaseUsage(workspaceId: string, metric: string, amount: number): Promise<void> {
    await this.db.query('select app.release_usage($1, $2, $3)', [workspaceId, metric, amount]);
  }

  async getUsage(workspaceId: string, plan: PlanRecord): Promise<UsageSummary> {
    const result = await this.db.query<{ metric: string; quantity: number; period_start: string }>(
      `select metric, quantity, period_start::text as period_start
       from public.usage_records
       where workspace_id = $1 and period_start = date_trunc('month', now())::date`,
      [workspaceId],
    );
    const metrics: Record<string, number> = {};
    for (const row of result.rows) metrics[row.metric] = Number(row.quantity);
    return {
      planId: plan.id,
      periodStart: result.rows[0]?.period_start ?? new Date().toISOString().slice(0, 8) + '01',
      metrics,
      limits: plan.limits,
    };
  }

  async getAnalytics(workspaceId: string, days: number): Promise<AnalyticsSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [runs, events, clicks, daily] = await Promise.all([
      this.db.query<{
        keyword_matches: number;
        public_attempted: number;
        public_sent: number;
        private_attempted: number;
        private_sent: number;
        failures: number;
        skipped: number;
      }>(
        `select
           count(*) filter (where matched_keyword is not null)::int as keyword_matches,
           count(*) filter (where public_reply_status in ('sending','sent','failed','unknown'))::int as public_attempted,
           count(*) filter (where public_reply_status = 'sent')::int as public_sent,
           count(*) filter (where private_reply_status in ('sending','sent','failed','unknown'))::int as private_attempted,
           count(*) filter (where private_reply_status = 'sent')::int as private_sent,
           count(*) filter (where status = 'failed' or public_reply_status = 'failed' or private_reply_status = 'failed')::int as failures,
           count(*) filter (where status = 'skipped')::int as skipped
         from public.automation_runs
         where workspace_id = $1 and created_at >= $2`,
        [workspaceId, since],
      ),
      this.db.query<{ received: number; processed: number; duplicates: number }>(
        `select count(*)::int as received,
                count(*) filter (where status = 'processed')::int as processed,
                coalesce(sum(duplicate_count), 0)::int as duplicates
         from public.webhook_events
         where workspace_id = $1 and received_at >= $2`,
        [workspaceId, since],
      ),
      this.countResourceClicksSince(workspaceId, since),
      this.db.query<{
        date: string;
        comments_received: number;
        public_sent: number;
        private_sent: number;
      }>(
        `with day_series as (
           select generate_series($2::date, current_date, interval '1 day')::date as day
         )
         select d.day::text as date,
           (select count(*) from public.webhook_events e
             where e.workspace_id = $1 and e.received_at >= d.day and e.received_at < d.day + interval '1 day')::int as comments_received,
           (select count(*) from public.automation_runs r
             where r.workspace_id = $1 and r.created_at >= d.day and r.created_at < d.day + interval '1 day'
               and r.public_reply_status = 'sent')::int as public_sent,
           (select count(*) from public.automation_runs r
             where r.workspace_id = $1 and r.created_at >= d.day and r.created_at < d.day + interval '1 day'
               and r.private_reply_status = 'sent')::int as private_sent
         from day_series d
         order by d.day asc`,
        [workspaceId, since],
      ),
    ]);

    const runRow = runs.rows[0];
    const eventRow = events.rows[0];
    return {
      rangeDays: days,
      commentsReceived: Number(eventRow?.received ?? 0),
      eventsProcessed: Number(eventRow?.processed ?? 0),
      keywordMatches: Number(runRow?.keyword_matches ?? 0),
      publicRepliesAttempted: Number(runRow?.public_attempted ?? 0),
      publicRepliesSent: Number(runRow?.public_sent ?? 0),
      privateRepliesAttempted: Number(runRow?.private_attempted ?? 0),
      privateRepliesSent: Number(runRow?.private_sent ?? 0),
      failures: Number(runRow?.failures ?? 0),
      duplicatesIgnored: Number(eventRow?.duplicates ?? 0),
      skipped: Number(runRow?.skipped ?? 0),
      resourceClicks: clicks,
      daily: daily.rows.map((row) => ({
        date: row.date,
        commentsReceived: Number(row.comments_received),
        publicRepliesSent: Number(row.public_sent),
        privateRepliesSent: Number(row.private_sent),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Audit + retention
  // -------------------------------------------------------------------------
  async recordAudit(input: {
    workspaceId: string | null;
    actorUserId: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db.query(
      `insert into public.audit_events (workspace_id, actor_user_id, action, target_type, target_id, metadata)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        input.workspaceId,
        input.actorUserId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  }

  async purgeOldData(webhookRetentionDays: number): Promise<{ events: number; states: number }> {
    const events = await this.db.query<{ deleted: number }>(
      'select app.cleanup_webhook_events($1) as deleted',
      [webhookRetentionDays],
    );
    const states = await this.db.query<{ deleted: number }>(
      'select app.cleanup_oauth_states() as deleted',
    );
    return {
      events: Number(first(events.rows)?.deleted ?? 0),
      states: Number(first(states.rows)?.deleted ?? 0),
    };
  }

  async recordMetaDataRequest(input: {
    code: string;
    metaUserId: string | null;
    kind: 'deauthorize' | 'data_deletion';
    details?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.db.query(
      `insert into public.meta_data_requests (code, meta_user_id, kind, status, completed_at, details)
       values ($1, $2, $3, 'completed', now(), $4)`,
      [
        input.code,
        input.metaUserId,
        input.kind,
        input.details ? JSON.stringify(input.details) : null,
      ],
    );
  }

  async getMetaDataRequest(code: string): Promise<{
    code: string;
    kind: string;
    status: string;
    requestedAt: Date;
    completedAt: Date | null;
  } | null> {
    const result = await this.db.query<{
      code: string;
      kind: string;
      status: string;
      requested_at: Date;
      completed_at: Date | null;
    }>(
      'select code, kind, status, requested_at, completed_at from public.meta_data_requests where code = $1',
      [code],
    );
    const row = first(result.rows);
    return row
      ? {
          code: row.code,
          kind: row.kind,
          status: row.status,
          requestedAt: row.requested_at,
          completedAt: row.completed_at,
        }
      : null;
  }

  private async count(sql: string, params: unknown[]): Promise<number> {
    const result = await this.db.query<{ count: number }>(sql, params);
    return Number(first(result.rows)?.count ?? 0);
  }
}
