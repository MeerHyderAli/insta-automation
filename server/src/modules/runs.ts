import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { runDto, runEventDto, webhookEventDto } from './serializers.js';
import { errors } from '../lib/errors.js';
import { parseInput } from '../middleware/validate.js';
import { requireWorkspace } from '../middleware/workspace.js';

const ListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    status: z
      .enum(['queued', 'processing', 'completed', 'partial', 'failed', 'skipped'])
      .optional(),
    accountId: z.string().uuid().optional(),
    ruleId: z.string().uuid().optional(),
  })
  .strict();

export function createRunsRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/runs', requireWorkspace(deps.store), async (req, res) => {
    const query = parseInput(ListSchema, req.query, 'Invalid filter.');
    const result = await deps.store.listRuns(req.workspace!.id, query);
    res.json({
      runs: result.items.map(runDto),
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + result.items.length < result.total,
      },
    });
  });

  router.get(
    '/workspaces/:workspaceId/runs/:runId',
    requireWorkspace(deps.store),
    async (req, res) => {
      const runId = parseInput(z.string().uuid(), req.params.runId, 'Invalid run id.');
      const run = await deps.store.getRun(req.workspace!.id, runId);
      if (!run) throw errors.notFound('Activity entry not found.');
      const events = await deps.store.listRunEvents(run.id);
      const webhookEvent = run.webhookEventId
        ? await deps.store.getWebhookEvent(run.webhookEventId)
        : null;
      res.json({
        run: runDto(run),
        events: events.map(runEventDto),
        webhook: webhookEvent ? webhookEventDto(webhookEvent) : null,
      });
    },
  );

  return router;
}
