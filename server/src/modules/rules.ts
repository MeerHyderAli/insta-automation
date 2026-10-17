import { Router } from 'express';
import { z } from 'zod';
import type { ModuleDeps } from './deps.js';
import { ruleDto, REQUIRED_SCOPES } from './serializers.js';
import { errors } from '../lib/errors.js';
import { isUniqueViolation } from '../lib/dbErrors.js';
import { matchKeywords, normalizeKeywords } from '../automation/matcher.js';
import {
  applyFollowInstructions,
  PRIVATE_REPLY_MAX_LENGTH,
  PUBLIC_REPLY_MAX_LENGTH,
  renderTemplate,
  validateTemplate,
} from '../automation/templates.js';
import { parseInput } from '../middleware/validate.js';
import { requireRole, requireWorkspace } from '../middleware/workspace.js';
import type { AccountRecord, ResourceRecord, RuleRecord } from '../types/domain.js';

const KeywordSchema = z.string().trim().min(1).max(50);
const TemplateSchema = z.string().max(2200);

const RuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    accountId: z.string().uuid(),
    mediaId: z.string().trim().min(1).max(64).nullable().optional(),
    keywords: z.array(KeywordSchema).min(1).max(20),
    publicReplyTemplate: TemplateSchema.nullable().optional(),
    privateReplyTemplate: TemplateSchema.nullable().optional(),
    resourceId: z.string().uuid().nullable().optional(),
    followGate: z.enum(['off', 'instruction']).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const UpdateRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    mediaId: z.string().trim().min(1).max(64).nullable().optional(),
    keywords: z.array(KeywordSchema).min(1).max(20).optional(),
    publicReplyTemplate: TemplateSchema.nullable().optional(),
    privateReplyTemplate: TemplateSchema.nullable().optional(),
    resourceId: z.string().uuid().nullable().optional(),
    followGate: z.enum(['off', 'instruction']).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const TestSchema = z
  .object({
    commentText: z.string().trim().min(1).max(2200),
    mediaId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

const RuleIdSchema = z.string().uuid();

/** The UI supports a disabled "verify follow" switch; the API refuses it explicitly. */
function rejectFollowVerification(body: unknown): void {
  if (
    body !== null &&
    typeof body === 'object' &&
    (body as { followGate?: unknown }).followGate === 'verify'
  ) {
    throw errors.capabilityUnavailable(
      'Meta does not expose follower status for arbitrary commenters, so follow verification cannot be enabled. Use "instruction only" mode instead.',
    );
  }
}

function cleanTemplate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface Resolved {
  account: AccountRecord;
  resource: ResourceRecord | null;
}

async function resolveReferences(
  deps: ModuleDeps,
  workspaceId: string,
  values: { accountId: string; mediaId: string | null; resourceId: string | null },
): Promise<Resolved> {
  const account = await deps.store.getAccount(workspaceId, values.accountId);
  if (!account) throw errors.validation('Select an Instagram account from this workspace.');
  if (values.mediaId) {
    const media = await deps.store.getMedia(account.id, values.mediaId);
    if (!media) {
      throw errors.validation(
        'Select a post or Reel that is synced for this account, or leave the scope on all posts.',
      );
    }
  }
  let resource: ResourceRecord | null = null;
  if (values.resourceId) {
    resource = await deps.store.getResource(workspaceId, values.resourceId);
    if (!resource) throw errors.validation('Select a resource from this workspace.');
  }
  return { account, resource };
}

function validateRule(
  values: {
    publicReplyTemplate: string | null;
    privateReplyTemplate: string | null;
    enabled: boolean;
  },
  account: AccountRecord,
  resource: ResourceRecord | null,
): { errors: string[]; warnings: string[] } {
  const errorsList: string[] = [];
  const warnings: string[] = [];
  if (!values.publicReplyTemplate && !values.privateReplyTemplate) {
    errorsList.push('Add at least one public reply or private reply template.');
  }
  errorsList.push(
    ...validateTemplate(values.publicReplyTemplate, {
      maxLength: PUBLIC_REPLY_MAX_LENGTH,
      label: 'Public reply',
      resourceAvailable: Boolean(resource),
    }),
    ...validateTemplate(values.privateReplyTemplate, {
      maxLength: PRIVATE_REPLY_MAX_LENGTH,
      label: 'Private reply',
      resourceAvailable: Boolean(resource),
    }),
  );
  if (
    values.privateReplyTemplate &&
    !account.scopes.includes('instagram_business_manage_messages')
  ) {
    warnings.push(
      'This automation includes a private reply, but the account has not granted instagram_business_manage_messages. Public replies still work; private replies will fail with a permission error until the account is reconnected with messaging access.',
    );
  }
  if (values.enabled) {
    if (account.status !== 'connected') {
      errorsList.push('Reconnect the Instagram account before enabling an automation.');
    }
    const missing = REQUIRED_SCOPES.filter((scope) => !account.scopes.includes(scope));
    if (missing.length > 0) {
      errorsList.push(
        `The Instagram account is missing permissions: ${missing.join(', ')}. Reconnect and approve comment management.`,
      );
    }
    if (!account.webhookSubscribedAt) {
      warnings.push(
        'Webhook delivery has not been confirmed for this app. Enable it from the Accounts page; comments will not arrive until Meta confirms the subscription.',
      );
    }
  }
  return { errors: errorsList, warnings };
}

function renderPreview(
  rule: Pick<
    RuleRecord,
    'publicReplyTemplate' | 'privateReplyTemplate' | 'followGate' | 'keywords'
  >,
  account: AccountRecord,
  resource: ResourceRecord | null,
  commentText: string,
  mediaId: string | null | undefined,
  scopedMediaId: string | null,
): Record<string, unknown> {
  const mediaScopedOut = Boolean(
    scopedMediaId && mediaId !== undefined && mediaId !== null && mediaId !== scopedMediaId,
  );
  const matchedKeyword = mediaScopedOut ? null : matchKeywords(commentText, rule.keywords);
  const context = {
    username: 'sample_commenter',
    keyword: matchedKeyword ?? rule.keywords[0] ?? 'KEYWORD',
    resourceUrl: resource?.url ?? '',
    resourceTitle: resource?.title ?? '',
    accountUsername: account.username,
    followInstructions: applyFollowInstructions('', rule.followGate, account.username).trim(),
  };
  const publicText = rule.publicReplyTemplate
    ? renderTemplate(rule.publicReplyTemplate, context)
    : null;
  const privateBase = rule.privateReplyTemplate
    ? renderTemplate(rule.privateReplyTemplate, context)
    : null;
  const privateText =
    privateBase === null
      ? null
      : applyFollowInstructions(privateBase, rule.followGate, account.username);
  return {
    matched: matchedKeyword !== null,
    matchedKeyword,
    publicReply: publicText
      ? {
          text: publicText,
          length: publicText.length,
          limit: PUBLIC_REPLY_MAX_LENGTH,
          errors: validateTemplate(rule.publicReplyTemplate, {
            maxLength: PUBLIC_REPLY_MAX_LENGTH,
            label: 'Public reply',
            resourceAvailable: Boolean(resource),
          }),
        }
      : null,
    privateReply: privateText
      ? {
          text: privateText,
          length: privateText.length,
          limit: PRIVATE_REPLY_MAX_LENGTH,
          errors: validateTemplate(rule.privateReplyTemplate, {
            maxLength: PRIVATE_REPLY_MAX_LENGTH,
            label: 'Private reply',
            resourceAvailable: Boolean(resource),
          }),
        }
      : null,
    notes: [
      'Test mode performs no Instagram API calls and sends nothing.',
      ...(mediaScopedOut
        ? ['The selected post does not match this rule’s media scope, so it would not trigger.']
        : []),
      'Private replies are allowed once per comment within 7 days of the comment.',
      'Follow status cannot be verified for commenters; clicking a resource is not follow proof.',
    ],
  };
}

export function createRulesRouter(deps: ModuleDeps): Router {
  const router = Router();

  router.get('/workspaces/:workspaceId/rules', requireWorkspace(deps.store), async (req, res) => {
    const rules = await deps.store.listRules(req.workspace!.id);
    res.json({ rules: rules.map(ruleDto) });
  });

  router.get(
    '/workspaces/:workspaceId/rules/:ruleId',
    requireWorkspace(deps.store),
    async (req, res) => {
      const ruleId = parseInput(RuleIdSchema, req.params.ruleId, 'Invalid automation id.');
      const rule = await deps.store.getRule(req.workspace!.id, ruleId);
      if (!rule) throw errors.notFound('Automation not found.');
      res.json({ rule: ruleDto(rule) });
    },
  );

  router.post(
    '/workspaces/:workspaceId/rules',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      rejectFollowVerification(req.body);
      const body = parseInput(RuleSchema, req.body);
      const workspace = req.workspace!;
      const plan = await deps.store.getPlan(workspace.planId);
      const count = await deps.store.countRules(workspace.id);
      if (plan && count >= plan.limits.rules) {
        throw errors.quotaExceeded(
          `The ${plan.name} plan allows ${plan.limits.rules} automations.`,
        );
      }
      const keywords = normalizeKeywords(body.keywords);
      if (keywords.length === 0) throw errors.validation('Add at least one keyword.');
      const values = {
        accountId: body.accountId,
        mediaId: body.mediaId ?? null,
        resourceId: body.resourceId ?? null,
      };
      const { account, resource } = await resolveReferences(deps, workspace.id, values);
      const templates = {
        publicReplyTemplate: cleanTemplate(body.publicReplyTemplate),
        privateReplyTemplate: cleanTemplate(body.privateReplyTemplate),
        enabled: body.enabled ?? false,
      };
      const check = validateRule(templates, account, resource);
      if (check.errors.length > 0) throw errors.validation(check.errors[0]!, check.errors);
      let rule: RuleRecord;
      try {
        rule = await deps.store.createRule({
          workspaceId: workspace.id,
          accountId: values.accountId,
          name: body.name,
          enabled: templates.enabled,
          mediaId: values.mediaId,
          keywords,
          publicReplyTemplate: templates.publicReplyTemplate,
          privateReplyTemplate: templates.privateReplyTemplate,
          resourceId: values.resourceId,
          followGate: body.followGate ?? 'off',
          priority: body.priority ?? 100,
          createdBy: req.user!.id,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw errors.conflict('An automation with that name already exists in this workspace.');
        }
        throw error;
      }
      await deps.store.recordAudit({
        workspaceId: workspace.id,
        actorUserId: req.user!.id,
        action: 'automation.created',
        targetType: 'automation_rule',
        targetId: rule.id,
      });
      res.status(201).json({ rule: ruleDto(rule), warnings: check.warnings });
    },
  );

  router.patch(
    '/workspaces/:workspaceId/rules/:ruleId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      rejectFollowVerification(req.body);
      const ruleId = parseInput(RuleIdSchema, req.params.ruleId, 'Invalid automation id.');
      const body = parseInput(UpdateRuleSchema, req.body);
      if (Object.keys(body).length === 0) throw errors.validation('Nothing to update.');
      const existing = await deps.store.getRule(req.workspace!.id, ruleId);
      if (!existing) throw errors.notFound('Automation not found.');

      const account = await deps.store.getAccount(req.workspace!.id, existing.accountId);
      if (!account) throw errors.validation('The account for this automation no longer exists.');
      const mediaId = body.mediaId !== undefined ? body.mediaId : existing.mediaId;
      if (mediaId) {
        const media = await deps.store.getMedia(account.id, mediaId);
        if (!media) throw errors.validation('Select a synced post or Reel for this account.');
      }
      const resourceId = body.resourceId !== undefined ? body.resourceId : existing.resourceId;
      let resource: ResourceRecord | null = null;
      if (resourceId) {
        resource = await deps.store.getResource(req.workspace!.id, resourceId);
        if (!resource) throw errors.validation('Select a resource from this workspace.');
      }
      const merged = {
        publicReplyTemplate:
          body.publicReplyTemplate !== undefined
            ? cleanTemplate(body.publicReplyTemplate)
            : existing.publicReplyTemplate,
        privateReplyTemplate:
          body.privateReplyTemplate !== undefined
            ? cleanTemplate(body.privateReplyTemplate)
            : existing.privateReplyTemplate,
        enabled: body.enabled !== undefined ? body.enabled : existing.enabled,
      };
      const check = validateRule(merged, account, resource);
      if (check.errors.length > 0) throw errors.validation(check.errors[0]!, check.errors);
      const keywords = body.keywords ? normalizeKeywords(body.keywords) : undefined;
      if (keywords && keywords.length === 0) throw errors.validation('Add at least one keyword.');
      let rule: RuleRecord;
      try {
        rule = await deps.store.updateRule(req.workspace!.id, ruleId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.mediaId !== undefined ? { mediaId: body.mediaId } : {}),
          ...(keywords ? { keywords } : {}),
          ...(body.publicReplyTemplate !== undefined
            ? { publicReplyTemplate: merged.publicReplyTemplate }
            : {}),
          ...(body.privateReplyTemplate !== undefined
            ? { privateReplyTemplate: merged.privateReplyTemplate }
            : {}),
          ...(body.resourceId !== undefined ? { resourceId: body.resourceId } : {}),
          ...(body.followGate !== undefined ? { followGate: body.followGate } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          enabled: merged.enabled,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw errors.conflict('An automation with that name already exists in this workspace.');
        }
        throw error;
      }
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'automation.updated',
        targetType: 'automation_rule',
        targetId: rule.id,
      });
      res.json({ rule: ruleDto(rule), warnings: check.warnings });
    },
  );

  router.post(
    '/workspaces/:workspaceId/rules/:ruleId/test',
    requireWorkspace(deps.store),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const ruleId = parseInput(RuleIdSchema, req.params.ruleId, 'Invalid automation id.');
      const body = parseInput(TestSchema, req.body);
      const rule = await deps.store.getRule(req.workspace!.id, ruleId);
      if (!rule) throw errors.notFound('Automation not found.');
      const account = await deps.store.getAccount(req.workspace!.id, rule.accountId);
      if (!account) throw errors.validation('The account for this automation no longer exists.');
      const resource = rule.resourceId
        ? await deps.store.getResource(req.workspace!.id, rule.resourceId)
        : null;
      res.json(
        renderPreview(rule, account, resource, body.commentText, body.mediaId, rule.mediaId),
      );
    },
  );

  router.delete(
    '/workspaces/:workspaceId/rules/:ruleId',
    requireWorkspace(deps.store),
    requireRole('owner', 'admin', 'member'),
    deps.rateLimiters.mutation,
    async (req, res) => {
      const ruleId = parseInput(RuleIdSchema, req.params.ruleId, 'Invalid automation id.');
      const existing = await deps.store.getRule(req.workspace!.id, ruleId);
      if (!existing) throw errors.notFound('Automation not found.');
      await deps.store.deleteRule(req.workspace!.id, ruleId);
      await deps.store.recordAudit({
        workspaceId: req.workspace!.id,
        actorUserId: req.user!.id,
        action: 'automation.deleted',
        targetType: 'automation_rule',
        targetId: ruleId,
      });
      res.status(204).end();
    },
  );

  return router;
}
