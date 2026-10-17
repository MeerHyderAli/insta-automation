import { describe, expect, it } from 'vitest';
import {
  BudgetedAiProvider,
  DailySuggestionBudget,
  TemplateReplyProvider,
  createAiProvider,
  validateSuggestion,
} from '../../src/ai/provider.js';
import { AppError } from '../../src/lib/errors.js';

describe('AI suggestion provider abstraction', () => {
  it('is disabled by default and exposes no provider', () => {
    expect(createAiProvider({ enabled: false })).toBeNull();
  });

  it('returns a deterministic template suggestion with placeholders', async () => {
    const template = new TemplateReplyProvider();
    const suggestion = await template.suggestReply({
      commentText: 'API please',
      keyword: 'API',
      accountUsername: 'acme.studio',
      resourceTitle: 'Prompt guide',
    });
    expect(suggestion.provider).toBe('template');
    expect(suggestion.text).toContain('{{username}}');
    expect(suggestion.text).toContain('Prompt guide');
    expect(suggestion.text).toContain('{{resource_url}}');
  });

  it('rejects empty, oversized and control-character output', () => {
    expect(() => validateSuggestion('   ')).toThrow(AppError);
    expect(() => validateSuggestion('x'.repeat(10), 5)).toThrow(/5 characters or fewer/);
    expect(() => validateSuggestion('bad\u0000output')).toThrow(AppError);
  });

  it('enforces a per-workspace daily budget and resets the next day', () => {
    let now = new Date('2026-10-17T10:00:00.000Z');
    const budget = new DailySuggestionBudget(2, () => now);
    expect(budget.tryConsume('ws-1')).toBe(true);
    expect(budget.tryConsume('ws-1')).toBe(true);
    expect(budget.tryConsume('ws-1')).toBe(false);
    expect(budget.tryConsume('ws-2')).toBe(true);
    expect(budget.remaining('ws-1')).toBe(0);
    now = new Date('2026-10-18T00:01:00.000Z');
    expect(budget.remaining('ws-1')).toBe(2);
    expect(budget.tryConsume('ws-1')).toBe(true);
  });

  it('blocks suggestions when the budget is exhausted', async () => {
    const budget = new DailySuggestionBudget(1);
    const provider = new BudgetedAiProvider(new TemplateReplyProvider(), budget, 'ws-1');
    await provider.suggestReply({ commentText: 'API', keyword: 'API', accountUsername: 'acme' });
    await expect(
      provider.suggestReply({ commentText: 'API', keyword: 'API', accountUsername: 'acme' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('validates the wrapped provider output instead of trusting it', async () => {
    const malicious = {
      name: 'fake',
      available: true,
      async suggestReply() {
        return { text: 'x'.repeat(2000), provider: 'fake' };
      },
    };
    const provider = new BudgetedAiProvider(malicious, new DailySuggestionBudget(5), 'ws-1');
    await expect(
      provider.suggestReply({ commentText: 'API', keyword: 'API', accountUsername: 'acme' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
