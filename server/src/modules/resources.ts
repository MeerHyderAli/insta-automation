import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { resourceDto } from './serializers.js';
import { errors } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import { createSlug } from '../lib/ids.js';
import { parseInput } from '../middleware/validate.js';
import { requireRole, requireWorkspace } from '../middleware/workspace.js';
import type { ResourceRecord } from '../types/domain.js';

const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Resource URLs must be valid HTTPS URLs without embedded credentials.');

const CreateSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    url: httpsUrl,
  })
  .strict();

const UpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    url: httpsUrl.optional(),
  })
  .strict();

const ResourceIdSchema = z.string().uuid();

export function createResourcesRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get(
    '/workspaces/:workspaceId/resources',
    requireWorkspace(deps.store),
    async (req, res) => {
      const resources = await deps.store.listResources(req.workspace!.id);
      res.json({
        resources: resources.map((resource) => resourceDto(resource, deps.config)),
      });
    },
  );

  router.post(
    '/workspaces/:workspaceId/resources',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const body = parseInput(CreateSchema, req.body);
      const workspace = req.workspace!;
      const plan = await deps.store.getPlan(workspace.planId);
      const count = await deps.store.countResources(workspace.id);
      if (plan && count >= plan.limits.resources) {
        throw errors.quotaExceeded(
          `The ${plan.name} plan allows ${plan.limits.resources} resources.`,
        );
      }
      let resource: ResourceRecord | null = null;
      for (let attempt = 0; attempt < 3 && !resource; attempt += 1) {
        try {
          resource = await deps.store.createResource({
            workspaceId: workspace.id,
            title: body.title,
            description: body.description?.trim() ? body.description : null,
            url: body.url,
            slug: createSlug(10),
            createdBy: req.user!.id,
          });
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 2) throw error;
        }
      }
      if (!resource) throw errors.internal('Could not create the resource link.');
      await deps.store.recordAudit({
        workspaceId: workspace.id,
        actorUserId: req.user!.id,
        action: 'resource.created',
        targetType: 'resource',
        targetId: resource.id,
      });
      res.status(201).json({ resource: resourceDto(resource, deps.config) });
    },
  );

  router.patch(
    '/workspaces/:workspaceId/resources/:resourceId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const resourceId = parseInput(
        ResourceIdSchema,
        req.params.resourceId,
        'Invalid resource id.',
      );
      const body = parseInput(UpdateSchema, req.body);
      if (Object.keys(body).length === 0) throw errors.validation('Nothing to update.');
      const existing = await deps.store.getResource(req.workspace!.id, resourceId);
      if (!existing) throw errors.notFound('Resource not found.');
      const updated = await deps.store.updateResource(req.workspace!.id, resourceId, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description?.trim() ? body.description : null }
          : {}),
        ...(body.url !== undefined ? { url: body.url } : {}),
      });
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'resource.updated',
        targetType: 'resource',
        targetId: resourceId,
      });
      res.json({ resource: resourceDto(updated, deps.config) });
    },
  );

  router.delete(
    '/workspaces/:workspaceId/resources/:resourceId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const resourceId = parseInput(
        ResourceIdSchema,
        req.params.resourceId,
        'Invalid resource id.',
      );
      const existing = await deps.store.getResource(req.workspace!.id, resourceId);
      if (!existing) throw errors.notFound('Resource not found.');
      await deps.store.deleteResource(req.workspace!.id, resourceId);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'resource.deleted',
        targetType: 'resource',
        targetId: resourceId,
      });
      res.status(204).end();
    },
  );

  return router;
}
