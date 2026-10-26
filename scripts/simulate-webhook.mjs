#!/usr/bin/env node
/**
 * Sends a signed FAKE "comments" webhook to your running app so you can test
 * the whole pipeline without Meta. This is a local simulation only — no real
 * Instagram event is created.
 *
 * Usage:
 *   npm run simulate -- "LINK please!"
 *   npm run simulate -- "give me the lnik" alice comment-123
 *
 * Reads META_APP_SECRET from the environment or .env.local.
 * WEBHOOK_URL overrides the default http://localhost:3000/api/webhook.
 */
import { createHmac } from 'node:crypto';
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

const appSecret = process.env.META_APP_SECRET;
if (!appSecret) {
  console.error('META_APP_SECRET is not set (environment or .env.local). Copy .env.example first.');
  process.exit(1);
}

const [text = 'LINK please!', username = 'alice', commentId = `sim-${Date.now()}`] =
  process.argv.slice(2);

const payload = {
  object: 'instagram',
  entry: [
    {
      id: process.env.IG_ACCOUNT_ID || '17841400008460056',
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: 'comments',
          value: {
            id: commentId,
            text,
            from: { id: `sim-user-${username}`, username },
            media: { id: 'sim-media-1', media_product_type: 'FEED' },
          },
        },
      ],
    },
  ],
};

const rawBody = JSON.stringify(payload);
const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
const url = process.env.WEBHOOK_URL || 'http://localhost:3000/api/webhook';

console.log(`Sending simulated comment ${commentId} from @${username}: "${text}"`);
console.log(`-> POST ${url}`);
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
  body: rawBody,
});
console.log(`<- ${response.status} ${await response.text()}`);
console.log('Open http://localhost:3000 to see the recorded comment.');
console.log('Run the same command again with the same comment id to prove dedupe:');
console.log(`  npm run simulate -- "${text}" ${username} ${commentId}`);
