import { errors } from '../lib/errors.js';

/**
 * Optional AI drafting, deliberately kept behind a tiny provider interface.
 *
 * The MVP does not call a paid AI service. `TemplateReplyProvider` is a
 * deterministic, zero-cost fallback that produces a reply *template* (with the
 * documented placeholders). Any future provider must:
 *   - be selected only when AI_SUGGESTIONS_ENABLED=true;
 *   - pass output through `validateSuggestion`;
 *   - be wrapped in `BudgetedAiProvider` so a workspace has a hard daily cap;
 *   - never auto-send: a human saves the rule and Meta is the only delivery
 *     confirmation source.
 */

export const AI_SUGGESTION_MAX_LENGTH = 900;

export interface ReplySuggestionContext {
  commentText: string;
  keyword: string;
  accountUsername: string;
  resourceTitle?: string | null;
}

export interface ReplySuggestion {
  text: string;
  provider: string;
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  suggestReply(context: ReplySuggestionContext): Promise<ReplySuggestion>;
}

/** Rejects empty, oversized or control-character output before it reaches a user. */
export function validateSuggestion(
  raw: string,
  maxLength: number = AI_SUGGESTION_MAX_LENGTH,
): string {
  const text = raw.normalize('NFKC').replace(/\r\n/g, '\n').trim();
  if (!text) throw errors.validation('The AI provider returned an empty suggestion.');
  if (text.length > maxLength) {
    throw errors.validation(`AI suggestions must be ${maxLength} characters or fewer.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw errors.validation('The AI suggestion contains control characters.');
  }
  return text;
}

/**
 * No-network fallback. It is a template, not a generated message; the user can
 * edit it before saving. Placeholders are rendered by the existing template
 * engine at send time.
 */
export class TemplateReplyProvider implements AiProvider {
  readonly name = 'template';
  readonly available = true;

  async suggestReply(context: ReplySuggestionContext): Promise<ReplySuggestion> {
    const resource = context.resourceTitle?.trim()
      ? ` I think this will help: ${context.resourceTitle.trim()}.`
      : '';
    const text = validateSuggestion(
      `Thanks for the ${context.keyword} comment, {{username}}!${resource} ` +
        `Here is the link: {{resource_url}}`,
    );
    return { text, provider: this.name };
  }
}

/** Per-workspace daily cap, independent of any external provider quota. */
export class DailySuggestionBudget {
  private readonly used = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  tryConsume(workspaceId: string): boolean {
    if (this.limit <= 0) return false;
    const day = this.day();
    const current = this.used.get(workspaceId);
    if (!current || current.day !== day) {
      this.used.set(workspaceId, { day, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  remaining(workspaceId: string): number {
    const current = this.used.get(workspaceId);
    if (!current || current.day !== this.day()) return Math.max(0, this.limit);
    return Math.max(0, this.limit - current.count);
  }
}

export class BudgetedAiProvider implements AiProvider {
  constructor(
    private readonly inner: AiProvider,
    private readonly budget: DailySuggestionBudget,
    private readonly workspaceId: string,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get available(): boolean {
    return this.inner.available;
  }

  async suggestReply(context: ReplySuggestionContext): Promise<ReplySuggestion> {
    if (!this.budget.tryConsume(this.workspaceId)) {
      throw errors.quotaExceeded(
        'The daily AI suggestion budget for this workspace is exhausted. Use a predefined template instead.',
      );
    }
    const result = await this.inner.suggestReply(context);
    return { ...result, text: validateSuggestion(result.text) };
  }
}

/**
 * Returns null when AI is disabled (the default). Wiring a paid provider is a
 * future change; the interface and safety wrapper already exist so it cannot
 * bypass budget/validation.
 */
export function createAiProvider(options: {
  enabled: boolean;
  dailyBudget?: number;
  now?: () => Date;
}): { provider: AiProvider; budget: DailySuggestionBudget } | null {
  if (!options.enabled) return null;
  return {
    provider: new TemplateReplyProvider(),
    budget: new DailySuggestionBudget(options.dailyBudget ?? 50, options.now),
  };
}
