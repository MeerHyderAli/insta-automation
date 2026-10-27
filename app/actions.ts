'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getConfig } from '../lib/config';
import { subscribeInstagramWebhooks } from '../lib/instagram';
import { getStore } from '../lib/store';

function fieldValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function dashboardWritesEnabled(): boolean {
  // The middleware enforces Basic Auth when these are set. Refuse writes
  // entirely when they are missing so a public dashboard cannot be used to
  // silently change the links sent to followers.
  return Boolean(process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_PASSWORD);
}

function redirectWithStatus(status: string): never {
  redirect(`/?resourceStatus=${status}#reel-resources`);
}

function redirectWithSetupStatus(status: string, error?: string): never {
  const params = new URLSearchParams({ setupStatus: status });
  if (error) params.set('setupError', error.slice(0, 240));
  redirect(`/?${params.toString()}#setup-checklist`);
}

function validMediaId(mediaId: string): boolean {
  return mediaId.length > 0 && mediaId.length <= 128 && !/\s/.test(mediaId);
}

export async function saveMediaResource(formData: FormData): Promise<void> {
  if (!dashboardWritesEnabled()) redirectWithStatus('auth-required');

  const mediaId = fieldValue(formData, 'mediaId');
  const url = fieldValue(formData, 'url');
  const label = fieldValue(formData, 'label');

  if (!validMediaId(mediaId) || url.length > 2048 || !isHttpUrl(url) || label.length > 120) {
    redirectWithStatus('invalid');
  }

  try {
    await getStore(getConfig()).upsertMediaResource({
      mediaId,
      url,
      label: label || null,
    });
  } catch {
    redirectWithStatus('error');
  }

  revalidatePath('/');
  redirectWithStatus('saved');
}

export async function deleteMediaResource(formData: FormData): Promise<void> {
  if (!dashboardWritesEnabled()) redirectWithStatus('auth-required');

  const mediaId = fieldValue(formData, 'mediaId');
  if (!validMediaId(mediaId)) redirectWithStatus('invalid');

  try {
    await getStore(getConfig()).deleteMediaResource(mediaId);
  } catch {
    redirectWithStatus('error');
  }

  revalidatePath('/');
  redirectWithStatus('deleted');
}


export async function subscribeInstagramAccount(_formData: FormData): Promise<void> {
  if (!dashboardWritesEnabled()) redirectWithSetupStatus('auth-required');

  const config = getConfig();
  if (!config.accessToken) redirectWithSetupStatus('token-missing');

  try {
    await subscribeInstagramWebhooks({
      accessToken: config.accessToken,
      graphVersion: config.graphVersion,
    });
  } catch (error) {
    redirectWithSetupStatus(
      'subscribe-error',
      error instanceof Error ? error.message : 'Unknown Instagram API error',
    );
  }

  revalidatePath('/');
  redirectWithSetupStatus('subscribed');
}
