import { NextResponse, type NextRequest } from 'next/server';
import { getConfig } from '../../../lib/config';
import { isInstagramWebhook, parseCommentEvents, parseMessageEvents } from '../../../lib/parse';
import { processCommentEvents, processMessageEvents } from '../../../lib/process';
import { safeEqualString, verifyMetaSignature } from '../../../lib/signature';
import { getStore } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta webhook verification handshake.
 * Meta calls GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * and expects the challenge echoed back as plain text when the token matches.
 */
export async function GET(request: NextRequest) {
  const config = getConfig();
  if (!config.verifyToken) {
    return new NextResponse('META_WEBHOOK_VERIFY_TOKEN is not configured', { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token && challenge && safeEqualString(token, config.verifyToken)) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new NextResponse('Webhook verification failed', { status: 403 });
}

/**
 * Comment and messaging webhook events. The signature is verified against the RAW body
 * before any parsing. Valid events are always answered with 200 once they
 * have been recorded (Meta retries non-200 responses for up to 36 hours;
 * the store's claim step makes those redeliveries harmless duplicates).
 */
export async function POST(request: NextRequest) {
  const config = getConfig();

  if (!config.appSecret) {
    return NextResponse.json({ error: 'META_APP_SECRET is not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyMetaSignature(rawBody, signature, config.appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isInstagramWebhook(payload)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const store = getStore(config);
    const comments = await processCommentEvents(parseCommentEvents(payload), {
      store,
      config,
    });
    const messages = await processMessageEvents(parseMessageEvents(payload), {
      store,
      config,
    });
    return NextResponse.json({ ok: true, comments, messages });
  } catch (error) {
    // Never log secrets or the raw payload. A 500 makes Meta retry, and
    // already-claimed comment ids are skipped as duplicates on redelivery.
    console.error('Webhook processing failed:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
