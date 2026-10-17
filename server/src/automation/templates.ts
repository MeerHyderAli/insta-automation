export const TEMPLATE_PLACEHOLDERS = [
  'username',
  'keyword',
  'resource_url',
  'resource_title',
  'account_username',
  'follow_instructions',
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

export interface TemplateContext {
  username: string;
  keyword: string;
  resourceUrl: string;
  resourceTitle: string;
  accountUsername: string;
  followInstructions: string;
}

// Self-imposed product limits, below Instagram's public reply limit.
export const PUBLIC_REPLY_MAX_LENGTH = 2000;
export const PRIVATE_REPLY_MAX_LENGTH = 900;

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

const CONTEXT_KEYS: Record<TemplatePlaceholder, keyof TemplateContext> = {
  username: 'username',
  keyword: 'keyword',
  resource_url: 'resourceUrl',
  resource_title: 'resourceTitle',
  account_username: 'accountUsername',
  follow_instructions: 'followInstructions',
};
// Strips C0 control characters except \n and \t; required before sending text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS_RE, '').replace(/\r\n/g, '\n').trim();
}

export function renderTemplate(template: string, context: TemplateContext): string {
  const replaced = template.replace(PLACEHOLDER_RE, (match, name: string) => {
    if ((TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) {
      return context[CONTEXT_KEYS[name as TemplatePlaceholder]];
    }
    return match;
  });
  return sanitizeText(replaced);
}

export interface TemplateValidationOptions {
  maxLength: number;
  label: string;
  resourceAvailable: boolean;
}

export function validateTemplate(
  template: string | null | undefined,
  options: TemplateValidationOptions,
): string[] {
  if (template === null || template === undefined) return [];
  const errors: string[] = [];
  if (template.length > options.maxLength) {
    errors.push(`${options.label} must be ${options.maxLength} characters or fewer.`);
  }
  if (sanitizeText(template).length === 0) {
    errors.push(`${options.label} cannot be empty.`);
  }
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const name = match[1] ?? '';
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)) {
      errors.push(`${options.label} uses an unknown placeholder {{${name}}}.`);
    }
    if (!options.resourceAvailable && (name === 'resource_url' || name === 'resource_title')) {
      errors.push(`${options.label} uses {{${name}}} but no resource is selected.`);
    }
  }
  if (template.includes('{{') && !/\{\{\s*[a-z_]+\s*\}\}/.test(template)) {
    errors.push(`${options.label} contains an unclosed placeholder.`);
  }
  return errors;
}

export function buildFollowInstructions(accountUsername: string): string {
  return `Follow @${accountUsername} so you do not miss the next drop.`;
}

export function applyFollowInstructions(
  message: string,
  gate: 'off' | 'instruction',
  accountUsername: string,
): string {
  if (gate !== 'instruction') return message;
  const instructions = buildFollowInstructions(accountUsername);
  if (message.includes(instructions)) return message;
  const combined = `${message}\n\n${instructions}`;
  return sanitizeText(combined);
}
