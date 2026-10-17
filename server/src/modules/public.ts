import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { errors } from '../lib/errors.js';

const SlugSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/, 'Invalid link.');

/**
 * First-party tracked redirect. Counts a click and forwards to the HTTPS
 * destination. No user identity is stored; the referrer is not forwarded.
 */
export function createPublicRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get('/r/:slug', deps.rateLimiters.mutation, async (req, res) => {
    const raw = req.params.slug;
    const slug = Array.isArray(raw) ? raw[0] : raw;
    const parsed = SlugSchema.safeParse(slug);
    if (!parsed.success) throw errors.notFound('Link not found.');
    const resource = await deps.store.getResourceBySlug(parsed.data);
    if (!resource) throw errors.notFound('Link not found.');
    await deps.store
      .recordResourceClick(resource, req.get('user-agent')?.slice(0, 500) ?? null)
      .catch(() => undefined);
    await deps.store
      .incrementUsage(resource.workspaceId, 'resource_clicks', 1)
      .catch(() => undefined);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.redirect(302, resource.url);
  });

  return router;
}
