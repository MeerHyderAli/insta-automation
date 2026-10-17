import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { errors } from '../lib/errors.js';
import { parseInput } from '../middleware/validate.js';
import { requireWorkspace } from '../middleware/workspace.js';

const AnalyticsQuery = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
  .strict();

/** Public Meta limits surfaced in the UI; see docs/META_API_FEASIBILITY.md. */
export const META_LIMITS = {
  privateRepliesPerHour: 750,
  privateReplyWindowDays: 7,
  publicReplyMaxLength: 2200,
  privateReplyMaxLength: 1000,
} as const;

export function createInsightsRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/analytics',
    requireWorkspace(deps.store),
    async (req, res) => {
      const query = parseInput(AnalyticsQuery, req.query, 'Invalid date range.');
      const analytics = await deps.store.getAnalytics(req.workspace!.id, query.days);
      res.json({ analytics, metaLimits: META_LIMITS });
    },
  );

  router.get('/workspaces/:workspaceId/usage', requireWorkspace(deps.store), async (req, res) => {
    const workspace = req.workspace!;
    const plan = await deps.store.getPlan(workspace.planId);
    if (!plan)
      throw errors.notConfigured('The plan catalogue is missing. Run database migrations.');
    const [usage, accounts, rules, resources, members] = await Promise.all([
      deps.store.getUsage(workspace.id, plan),
      deps.store.countAccounts(workspace.id),
      deps.store.countRules(workspace.id),
      deps.store.countResources(workspace.id),
      deps.store.countMembers(workspace.id),
    ]);
    res.json({
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        limits: plan.limits,
      },
      periodStart: usage.periodStart,
      metrics: usage.metrics,
      counts: { accounts, rules, resources, members },
      metaLimits: META_LIMITS,
      notes: [
        'Monthly private-reply quotas are enforced atomically before each send.',
        'Comments processed is counted when a comment matches an automation.',
        'Resource clicks do not prove that a person followed the account.',
      ],
    });
  });

  return router;
}
