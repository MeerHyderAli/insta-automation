import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

/** Unambiguous short link slug (no 0/1/l). */
export function createSlug(length = 10): string {
  const bytes = randomUUID().replace(/-/g, '');
  let output = '';
  for (let index = 0; index < length; index += 1) {
    const nibble = Number.parseInt(bytes.slice(index * 2, index * 2 + 2) || '0', 16);
    output += SLUG_ALPHABET[nibble % SLUG_ALPHABET.length];
  }
  return output;
}

export function workspaceSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${createSlug(6)}`;
}

export function absoluteUrl(base: string, pathname: string): string {
  return new URL(pathname, `${base.replace(/\/$/, '')}/`).toString();
}
