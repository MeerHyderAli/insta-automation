#!/usr/bin/env node
/**
 * Refreshes a long-lived Instagram access token (valid ~60 days each time).
 * The current token must be at least 24 hours old and not yet expired.
 *
 *   GET https://graph.instagram.com/refresh_access_token
 *       ?grant_type=ig_refresh_token&access_token=<CURRENT_TOKEN>
 *
 * Prints the NEW token to YOUR terminal only — treat it like a password,
 * paste it into your host's IG_ACCESS_TOKEN env var and redeploy. Set a
 * recurring reminder well before day 60.
 */
import { readFileSync, existsSync } from 'node:fs';

function loadEnvLocal() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const token = process.env.IG_ACCESS_TOKEN;
if (!token) {
  console.error('IG_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
const response = await fetch(`https://graph.instagram.com/refresh_access_token?${params}`);
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.access_token) {
  console.error('Refresh failed:', JSON.stringify(body.error ?? body));
  console.error('If the token already expired, generate a fresh one in the Meta app dashboard.');
  process.exit(1);
}

const days = body.expires_in ? Math.round(body.expires_in / 86400) : '?';
console.log(`New token (valid ~${days} days) — update IG_ACCESS_TOKEN in your host now:`);
console.log(body.access_token);
