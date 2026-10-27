#!/usr/bin/env node
/**
 * Subscribes YOUR Instagram account to this app's webhooks.
 * Without this one-time call Meta will not deliver comment/message events, even if
 * the webhook itself is configured in the app dashboard.
 *
 *   POST https://graph.instagram.com/<version>/me/subscribed_apps
 *        ?subscribed_fields=comments,messages,messaging_postbacks
 *
 * Reads IG_ACCESS_TOKEN from the environment or .env.local. The token is
 * never printed.
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
  console.error('IG_ACCESS_TOKEN is not set. Generate a token in the Meta app dashboard first.');
  process.exit(1);
}

const version = process.env.META_GRAPH_VERSION || 'v25.0';
const fields = new URLSearchParams({ subscribed_fields: 'comments,messages,messaging_postbacks' });
const url = `https://graph.instagram.com/${version}/me/subscribed_apps?${fields}`;
const response = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`${response.status} ${await response.text()}`);
console.log('Expected: {"success": true}');
