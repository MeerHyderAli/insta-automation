import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { memberDto, profileDto, workspaceDto } from './serializers.js';
import { errors } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import { createSlug } from '../lib/ids.js';
import { parseInput } from '../middleware/validate.js';
import { requireRole, requireWorkspace } from '../middleware/workspace.js';

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use a valid IANA timezone, for example Asia/Kolkata.');

const CreateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    timezone: timezoneSchema.optional(),
  })
  .strict();

const UpdateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

const DeleteWorkspaceSchema = z.object({ confirmName: z.string().trim().min(1) }).strict();

const MemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['admin', 'member']),
  })
  .strict();

const MemberRoleSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();

export function createWorkspacesRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get('/me', async (req, res) => {
    const user = req.user!;
    const profile = await deps.store.upsertProfile({ id: user.id, email: user.email });
    const workspaces = await deps.store.listWorkspacesForUser(user.id);
    res.json({
      user: { id: user.id, email: user.email },
      profile: profileDto(profile),
      workspaces: workspaces.map((workspace) =>
        workspaceDto(workspace, workspace.role, workspace.plan),
      ),
    });
  });

  router.patch('/me', async (req, res) => {
    const body = parseInput(
      z.object({ fullName: z.string().trim().max(80).nullable() }).strict(),
      req.body,
    );
    await deps.store.upsertProfile({ id: req.user!.id, email: req.user!.email });
    const profile = await deps.store.updateProfile(req.user!.id, {
      fullName: body.fullName?.trim() ? body.fullName.trim() : null,
    });
    res.json({ profile: profileDto(profile) });
  });

  router.get('/workspaces', async (req, res) => {
    const workspaces = await deps.store.listWorkspacesForUser(req.user!.id);
    res.json({
      workspaces: workspaces.map((workspace) =>
        workspaceDto(workspace, workspace.role, workspace.plan),
      ),
    });
  });

  router.post('/workspaces', deps.rateLimiters.mutation, async (req, res) => {
    const body = parseInput(CreateWorkspaceSchema, req.body);
    const user = req.user!;
    await deps.store.upsertProfile({ id: user.id, email: user.email });
    let workspace = null;
    for (let attempt = 0; attempt < 3 && !workspace; attempt += 1) {
      try {
        workspace = await deps.store.createWorkspace({
          name: body.name,
          slug: `${createSlug(8)}`,
          planId: 'free',
          timezone: body.timezone ?? 'UTC',
          createdBy: user.id,
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }
    if (!workspace) throw errors.internal('Could not create the workspace.');
    await deps.store.recordAudit({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: workspace.id,
    });
    res.status(201).json({ workspace: workspaceDto(workspace, 'owner') });
  });

  router.get('/workspaces/:workspaceId', requireWorkspace(deps.store), async (req, res) => {
    const workspace = req.workspace!;
    const plan = await deps.store.getPlan(workspace.planId);
    const [accounts, rules, resources, members] = await Promise.all([
      deps.store.countAccounts(workspace.id),
      deps.store.countRules(workspace.id),
      deps.store.countResources(workspace.id),
      deps.store.countMembers(workspace.id),
    ]);
    res.json({
      workspace: workspaceDto(workspace, req.membership!.role, plan),
      counts: { accounts, rules, resources, members },
    });
  });

  router.patch(
    '/workspaces/:workspaceId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const body = parseInput(UpdateWorkspaceSchema, req.body);
      if (Object.keys(body).length === 0) throw errors.validation('Nothing to update.');
      const updated = await deps.store.updateWorkspace(req.workspace!.id, body);
      const plan = await deps.store.getPlan(updated.planId);
      await deps.store.recordAudit({
        workspaceId: updated.id,
        actorUserId: req.user!.id,
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: updated.id,
        metadata: body,
      });
      res.json({ workspace: workspaceDto(updated, req.membership!.role, plan) });
    },
  );

  router.delete(
    '/workspaces/:workspaceId',
    requireWorkspace(deps.store),
    requireRole('owner'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const body = parseInput(DeleteWorkspaceSchema, req.body);
      if (body.confirmName !== req.workspace!.name) {
        throw errors.validation('Type the exact workspace name to confirm deletion.');
      }
      await deps.store.deleteWorkspace(req.workspace!.id);
      res.status(204).end();
    },
  );

  router.get('/workspaces/:workspaceId/members', requireWorkspace(deps.store), async (req, res) => {
    const members = await deps.store.listMembers(req.workspace!.id);
    res.json({ members: members.map(memberDto) });
  });

  router.post(
    '/workspaces/:workspaceId/members',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const body = parseInput(MemberSchema, req.body);
      const workspace = req.workspace!;
      const plan = await deps.store.getPlan(workspace.planId);
      const count = await deps.store.countMembers(workspace.id);
      if (plan && count >= plan.limits.members) {
        throw errors.quotaExceeded(
          `The ${plan.name} plan allows ${plan.limits.members} member(s).`,
        );
      }
      const profile = await deps.store.findProfileByEmail(body.email);
      if (!profile) {
        throw errors.notFound(
          'No user with that email has signed in yet. Ask them to sign in first; invitations are not sent automatically in this MVP.',
        );
      }
      const existing = await deps.store.getMembership(workspace.id, profile.id);
      if (existing) throw errors.conflict('That user is already a workspace member.');
      const member = await deps.store.addMember(workspace.id, profile.id, body.role);
      await deps.store.recordAudit({
        workspaceId: workspace.id,
        actorUserId: req.user!.id,
        action: 'workspace.member_added',
        targetType: 'user',
        targetId: profile.id,
        metadata: { role: body.role },
      });
      res.status(201).json({ member: memberDto(member) });
    },
  );

  router.patch(
    '/workspaces/:workspaceId/members/:userId',
    requireWorkspace(deps.store),
    requireRole('owner'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const body = parseInput(MemberRoleSchema, req.body);
      const userId = z.string().uuid().parse(req.params.userId);
      const target = await deps.store.getMembership(req.workspace!.id, userId);
      if (!target) throw errors.notFound('Member not found.');
      if (target.role === 'owner')
        throw errors.forbidden('The workspace owner role cannot be changed.');
      await deps.store.updateMemberRole(req.workspace!.id, userId, body.role);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'workspace.member_role_changed',
        targetType: 'user',
        targetId: userId,
        metadata: { role: body.role },
      });
      res.json({ ok: true });
    },
  );

  router.delete(
    '/workspaces/:workspaceId/members/:userId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const userId = z.string().uuid().parse(req.params.userId);
      const target = await deps.store.getMembership(req.workspace!.id, userId);
      if (!target) throw errors.notFound('Member not found.');
      if (target.role === 'owner') throw errors.forbidden('The workspace owner cannot be removed.');
      if (userId === req.user!.id) throw errors.forbidden('You cannot remove yourself.');
      await deps.store.removeMember(req.workspace!.id, userId);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'workspace.member_removed',
        targetType: 'user',
        targetId: userId,
      });
      res.status(204).end();
    },
  );

  return router;
}
