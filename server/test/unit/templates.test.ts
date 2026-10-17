import { describe, expect, it } from 'vitest';
import {
  applyFollowInstructions,
  buildFollowInstructions,
  PRIVATE_REPLY_MAX_LENGTH,
  PUBLIC_REPLY_MAX_LENGTH,
  renderTemplate,
  sanitizeText,
  validateTemplate,
  type TemplateContext,
} from '../../src/automation/templates.js';

const context: TemplateContext = {
  username: 'reader',
  keyword: 'API',
  resourceUrl: 'https://example.com/guide',
  resourceTitle: 'Guide',
  accountUsername: 'creator',
  followInstructions: 'Follow @creator so you do not miss the next drop.',
};

describe('template rendering', () => {
  it('replaces documented placeholders only', () => {
    expect(renderTemplate('Hi {{username}}, {{ keyword }}: {{resource_url}}', context)).toBe(
      'Hi reader, API: https://example.com/guide',
    );
    expect(renderTemplate('{{unknown}} stays', context)).toBe('{{unknown}} stays');
  });

  it('strips control characters and normalizes CRLF', () => {
    expect(sanitizeText('a\u0000b\r\nc  ')).toBe('ab\nc');
  });
});

describe('template validation', () => {
  it('accepts a valid template', () => {
    expect(
      validateTemplate('Hi {{username}}', {
        maxLength: PUBLIC_REPLY_MAX_LENGTH,
        label: 'Public reply',
        resourceAvailable: false,
      }),
    ).toEqual([]);
  });

  it('rejects unknown placeholders and unclosed braces', () => {
    const unknown = validateTemplate('Hi {{first_name}}', {
      maxLength: PUBLIC_REPLY_MAX_LENGTH,
      label: 'Public reply',
      resourceAvailable: false,
    });
    const unclosed = validateTemplate('Hi {{username', {
      maxLength: PUBLIC_REPLY_MAX_LENGTH,
      label: 'Public reply',
      resourceAvailable: false,
    });
    expect(unknown[0]).toContain('unknown placeholder');
    expect(unclosed[0]).toContain('unclosed placeholder');
  });

  it('requires a resource when resource placeholders are used', () => {
    const issues = validateTemplate('Get {{resource_url}}', {
      maxLength: PUBLIC_REPLY_MAX_LENGTH,
      label: 'Public reply',
      resourceAvailable: false,
    });
    expect(issues.some((issue) => issue.includes('no resource is selected'))).toBe(true);
  });

  it('enforces the configured maximum length', () => {
    const issues = validateTemplate('x'.repeat(PRIVATE_REPLY_MAX_LENGTH + 1), {
      maxLength: PRIVATE_REPLY_MAX_LENGTH,
      label: 'Private reply',
      resourceAvailable: false,
    });
    expect(issues.some((issue) => issue.includes(String(PRIVATE_REPLY_MAX_LENGTH)))).toBe(true);
  });
});

describe('follow instruction mode', () => {
  it('appends a single instruction and is idempotent', () => {
    const instructions = buildFollowInstructions('creator');
    const once = applyFollowInstructions('Here you go', 'instruction', 'creator');
    const twice = applyFollowInstructions(once, 'instruction', 'creator');
    expect(once).toContain(instructions);
    expect(twice).toBe(once);
  });

  it('does nothing when the gate is off', () => {
    expect(applyFollowInstructions('Here you go', 'off', 'creator')).toBe('Here you go');
  });
});
