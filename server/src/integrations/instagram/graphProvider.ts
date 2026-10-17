import type { AppConfig } from '../../config/env.js';
import { errors } from '../../lib/errors.js';
import { redactSecrets } from '../../lib/redact.js';
import { MetaApiError, toMetaApiError } from './errors.js';
import type {
  InstagramMedia,
  InstagramProfile,
  InstagramProvider,
  InstagramTokenResult,
  LongLivedTokenResult,
} from './provider.js';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_ORIGIN = 'https://graph.instagram.com';
const REQUEST_TIMEOUT_MS = 15_000;

export interface GraphProviderOptions {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
  scopes: string[];
}

function tokenFromResponse(body: Record<string, unknown>): {
  accessToken: string;
  expiresIn: number;
  userId: string | null;
  permissions: string[];
} {
  const data = Array.isArray(body.data) ? (body.data[0] as Record<string, unknown>) : body;
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new MetaApiError({ message: 'Instagram token exchange returned no access token.' });
  }
  const rawPermissions = Array.isArray(data.permissions) ? data.permissions : [];
  const permissions = rawPermissions
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { name?: unknown }).name === 'string'
      ) {
        return (entry as { name: string }).name;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return {
    accessToken,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 3600,
    userId: typeof body.user_id === 'string' ? body.user_id : null,
    permissions,
  };
}

export class GraphInstagramProvider implements InstagramProvider {
  readonly configured = true;
  private readonly options: GraphProviderOptions;

  constructor(options: GraphProviderOptions) {
    this.options = options;
  }

  static fromConfig(config: AppConfig): GraphInstagramProvider | null {
    if (!config.meta.configured) return null;
    if (!config.meta.appId || !config.meta.appSecret || !config.meta.redirectUri) return null;
    return new GraphInstagramProvider({
      appId: config.meta.appId,
      appSecret: config.meta.appSecret,
      redirectUri: config.meta.redirectUri,
      graphVersion: config.meta.graphVersion,
      scopes: config.meta.scopes,
    });
  }

  buildAuthorizeUrl(input: { state: string }): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', this.options.appId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.options.scopes.join(','));
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<InstagramTokenResult> {
    const body = new URLSearchParams({
      client_id: this.options.appId,
      client_secret: this.options.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    const json = await this.request<Record<string, unknown>>(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const parsed = tokenFromResponse(json);
    return { ...parsed, userId: parsed.userId };
  }

  async exchangeLongLivedToken(shortToken: string): Promise<LongLivedTokenResult> {
    const url = new URL('/access_token', GRAPH_ORIGIN);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', this.options.appSecret);
    url.searchParams.set('access_token', shortToken);
    const json = await this.request<Record<string, unknown>>(url.toString(), { method: 'GET' });
    return this.longLivedResult(json);
  }

  async refreshToken(token: string): Promise<LongLivedTokenResult> {
    const url = new URL('/refresh_access_token', GRAPH_ORIGIN);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', token);
    const json = await this.request<Record<string, unknown>>(url.toString(), { method: 'GET' });
    return this.longLivedResult(json);
  }

  private longLivedResult(json: Record<string, unknown>): LongLivedTokenResult {
    const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
    if (!accessToken) throw new MetaApiError({ message: 'Instagram returned no access token.' });
    return {
      accessToken,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 60 * 24 * 60 * 60,
    };
  }

  async getProfile(token: string): Promise<InstagramProfile> {
    const url = this.graphUrl('/me');
    url.searchParams.set('fields', 'user_id,id,username,account_type');
    const json = await this.request<Record<string, unknown>>(url.toString(), {
      method: 'GET',
      token,
    });
    const igUserId =
      (typeof json.user_id === 'string' && json.user_id) ||
      (typeof json.id === 'string' && json.id) ||
      '';
    const metaUserId = typeof json.id === 'string' ? json.id : null;
    if (!igUserId) throw new MetaApiError({ message: 'Instagram profile has no account id.' });
    return {
      igUserId,
      metaUserId,
      username: typeof json.username === 'string' ? json.username : 'instagram_user',
      accountType: typeof json.account_type === 'string' ? json.account_type : null,
    };
  }

  async getMedia(token: string, igUserId: string): Promise<InstagramMedia[]> {
    const first = new URL(this.graphUrl(`/${encodeURIComponent(igUserId)}/media`).toString());
    first.searchParams.set(
      'fields',
      'id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp',
    );
    first.searchParams.set('limit', '50');
    const items: InstagramMedia[] = [];
    let nextUrl: string | null = first.toString();
    for (let pageIndex = 0; pageIndex < 10 && nextUrl; pageIndex += 1) {
      const parsed: URL = new URL(nextUrl);
      if (parsed.origin !== GRAPH_ORIGIN) break;
      const payload: {
        data?: Array<Record<string, unknown>>;
        paging?: { next?: string };
      } = await this.request(parsed.toString(), { method: 'GET', token });
      for (const item of payload.data ?? []) {
        if (typeof item.id !== 'string') continue;
        items.push({
          id: item.id,
          mediaType: typeof item.media_type === 'string' ? item.media_type : null,
          mediaProductType:
            typeof item.media_product_type === 'string' ? item.media_product_type : null,
          caption: typeof item.caption === 'string' ? item.caption : null,
          permalink: typeof item.permalink === 'string' ? item.permalink : null,
          thumbnailUrl: typeof item.thumbnail_url === 'string' ? item.thumbnail_url : null,
          timestamp:
            typeof item.timestamp === 'string' && !Number.isNaN(Date.parse(item.timestamp))
              ? new Date(item.timestamp)
              : null,
        });
      }
      nextUrl = typeof payload.paging?.next === 'string' ? payload.paging.next : null;
    }
    return items;
  }

  async subscribeWebhooks(token: string, fields: string[]): Promise<void> {
    const url = this.graphUrl('/me/subscribed_apps');
    url.searchParams.set('subscribed_fields', fields.join(','));
    const json = await this.request<Record<string, unknown>>(url.toString(), {
      method: 'POST',
      token,
    });
    if (json.success !== true) {
      throw new MetaApiError({
        message: 'Instagram did not confirm the webhook subscription.',
      });
    }
  }

  async replyToComment(token: string, commentId: string, message: string): Promise<{ id: string }> {
    const url = this.graphUrl(`/${encodeURIComponent(commentId)}/replies`);
    const json = await this.request<{ id?: string }>(url.toString(), {
      method: 'POST',
      token,
      json: { message },
    });
    if (typeof json.id !== 'string' || json.id.length === 0) {
      throw new MetaApiError({ message: 'Instagram did not confirm the public reply.' });
    }
    return { id: json.id };
  }

  async sendPrivateReply(
    token: string,
    igUserId: string,
    commentId: string,
    message: string,
  ): Promise<{ messageId: string; recipientId: string | null }> {
    const url = this.graphUrl(`/${encodeURIComponent(igUserId)}/messages`);
    const json = await this.request<{ message_id?: string; recipient_id?: string }>(
      url.toString(),
      {
        method: 'POST',
        token,
        json: { recipient: { comment_id: commentId }, message: { text: message } },
      },
    );
    if (typeof json.message_id !== 'string' || json.message_id.length === 0) {
      throw new MetaApiError({ message: 'Instagram did not confirm the private reply.' });
    }
    return {
      messageId: json.message_id,
      recipientId: typeof json.recipient_id === 'string' ? json.recipient_id : null,
    };
  }

  private graphUrl(pathname: string): URL {
    return new URL(`/${this.options.graphVersion}${pathname}`, GRAPH_ORIGIN);
  }

  private async request<T>(
    url: string,
    init: {
      method: 'GET' | 'POST';
      token?: string;
      json?: unknown;
      headers?: Record<string, string>;
      body?: URLSearchParams;
    },
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...init.headers };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let body: string | undefined;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.body) {
      body = init.body.toString();
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new MetaApiError({
        message: 'Could not reach Instagram. Check the server network and try again.',
        httpStatus: 503,
      });
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw toMetaApiError(response.status, parsed);
    }
    if (parsed === null) {
      throw new MetaApiError({
        message: redactSecrets(`Instagram returned a non-JSON response (${response.status}).`),
        httpStatus: response.status,
      });
    }
    return parsed as T;
  }
}

/** Used when Meta credentials are absent; every operation fails closed. */
export class UnavailableInstagramProvider implements InstagramProvider {
  readonly configured = false;

  private fail(): never {
    throw errors.notConfigured(
      'Instagram integration is not configured. Set META_APP_ID, META_APP_SECRET, META_REDIRECT_URI and META_WEBHOOK_VERIFY_TOKEN on the server.',
    );
  }

  buildAuthorizeUrl(): string {
    this.fail();
  }
  async exchangeCode(): Promise<InstagramTokenResult> {
    this.fail();
  }
  async exchangeLongLivedToken(): Promise<LongLivedTokenResult> {
    this.fail();
  }
  async refreshToken(): Promise<LongLivedTokenResult> {
    this.fail();
  }
  async getProfile(): Promise<InstagramProfile> {
    this.fail();
  }
  async getMedia(): Promise<InstagramMedia[]> {
    this.fail();
  }
  async subscribeWebhooks(): Promise<void> {
    this.fail();
  }
  async replyToComment(): Promise<{ id: string }> {
    this.fail();
  }
  async sendPrivateReply(): Promise<{ messageId: string; recipientId: string | null }> {
    this.fail();
  }
}

export function createInstagramProvider(config: AppConfig): InstagramProvider {
  return GraphInstagramProvider.fromConfig(config) ?? new UnavailableInstagramProvider();
}
