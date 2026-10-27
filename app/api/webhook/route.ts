import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getConfig, type AppConfig } from '../../../lib/config';
import {
  isInstagramWebhook,
  parseCommentEvents,
  parseMessageEvents,
  summarizeWebhookPayload,
} from '../../../lib/parse';
import { processCommentEvents, processMessageEvents } from '../../../lib/process';
import { safeEqualString, verifyMetaSignature } from '../../../lib/signature';
import { getStore } from '../../../lib/store';
import type {
  MessageProcessSummary,
  ProcessSummary,
  WebhookPayloadSummary,
  WebhookReceiptStatus,
} from '../../../lib/types';

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

function resultSummary(comments: ProcessSummary, messages: MessageProcessSummary): string {
  return [
    `comments received=${comments.received}`,
    `matched=${comments.matched}`,
    `promptSent=${comments.promptSent}`,
    `failed=${comments.failed}`,
    `duplicates=${comments.duplicates}`,
    `skippedNotFollowing=${comments.skippedNotFollowing}`,
    `skippedFollowUnverified=${comments.skippedFollowUnverified}`,
    `messages received=${messages.received}`,
    `linkSent=${messages.linkSent}`,
    `messageFailed=${messages.failed}`,
  ].join(', ');
}

/**
 * Comment and messaging webhook events. The signature is verified against the RAW body
 * before any parsing. Valid events are always answered with 200 once they
 * have been recorded (Meta retries non-200 responses for up to 36 hours;
 * the store's claim step makes those redeliveries harmless duplicates).
 *
 * A metadata-only receipt is also stored for dashboard diagnostics. It never
 * contains the raw payload, comment/message text, usernames, signatures, or
 * secrets.
 */
export async function POST(request: NextRequest) {
  const config: AppConfig = getConfig();

  if (!config.appSecret) {
    return NextResponse.json({ error: 'META_APP_SECRET is not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const signaturePresent = Boolean(signature);
  const receivedAt = new Date().toISOString();
  let payloadSummary: WebhookPayloadSummary = {
    payloadObject: null,
    entryCount: 0,
    entryFields: [],
  };
  let parsedCommentCount = 0;
  let parsedMessageCount = 0;

  const recordReceipt = async (
    status: WebhookReceiptStatus,
    httpStatus: number,
    extras: { resultSummary?: string | null; error?: string | null } = {},
  ): Promise<void> => {
    // Do not let completely unsigned internet noise write diagnostic rows.
    // Meta event notifications include a signature header.
    if (!signaturePresent && status === 'invalid_signature') return;
    try {
      await getStore(config).recordWebhookReceipt({
        id: randomUUID(),
        receivedAt,
        status,
        httpStatus,
        signaturePresent,
        ...payloadSummary,
        parsedComments: parsedCommentCount,
        parsedMessages: parsedMessageCount,
        resultSummary: extras.resultSummary ?? null,
        error: extras.error ?? null,
      });
    } catch (error) {
      // Diagnostics must never change the webhook response Meta receives.
      console.error(
        'Could not record webhook receipt:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  };

  if (!verifyMetaSignature(rawBody, signature, config.appSecret)) {
    try {
      payloadSummary = summarizeWebhookPayload(JSON.parse(rawBody) as unknown);
    } catch {
      // Keep the empty summary; the important fact is the signature failed.
    }
    await recordReceipt('invalid_signature', 403, {
      error: 'X-Hub-Signature-256 did not match META_APP_SECRET',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await recordReceipt('invalid_json', 400, { error: 'Signed body was not valid JSON' });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  payloadSummary = summarizeWebhookPayload(payload);

  if (!isInstagramWebhook(payload)) {
    await recordReceipt('ignored_non_instagram', 200, {
      error: `Payload object was ${payloadSummary.payloadObject ?? 'missing'}, not instagram`,
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const store = getStore(config);
    const parsedComments = parseCommentEvents(payload);
    const parsedMessages = parseMessageEvents(payload);
    parsedCommentCount = parsedComments.length;
    parsedMessageCount = parsedMessages.length;

    const comments = await processCommentEvents(parsedComments, {
      store,
      config,
    });
    const messages = await processMessageEvents(parsedMessages, {
      store,
      config,
    });
    await recordReceipt('processed', 200, {
      resultSummary: resultSummary(comments, messages),
    });
    return NextResponse.json({ ok: true, comments, messages });
  } catch (error) {
    // Never log secrets or the raw payload. A 500 makes Meta retry, and
    // already-claimed comment ids are skipped as duplicates on redelivery.
    console.error('Webhook processing failed:', error instanceof Error ? error.message : 'unknown error');
    await recordReceipt('processing_failed', 500, {
      error: 'Webhook processing failed; check server logs',
    });
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
