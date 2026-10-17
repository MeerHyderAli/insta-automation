import type { NextFunction, Request, Response } from 'express';
import type { Store } from '../db/store.js';
import { errors } from '../lib/errors.js';
import type { WorkspaceRole } from '../types/domain.js';

/**
 * Resolves `:workspaceId` and verifies membership. Non-members get 404 (not
 * 403) so the API never confirms that a tenant exists.
 */
export function requireWorkspace(store: Store) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) throw errors.unauthenticated();
      const rawWorkspaceId = req.params.workspaceId;
      const workspaceId = Array.isArray(rawWorkspaceId) ? rawWorkspaceId[0] : rawWorkspaceId;
      if (!workspaceId) throw errors.validation('Workspace id is required.');
      const context = await store.getWorkspaceForUser(workspaceId, user.id);
      if (!context) throw errors.notFound('Workspace not found.');
      req.workspace = context.workspace;
      req.membership = { role: context.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...allowed: WorkspaceRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.membership?.role;
    if (!role) {
      next(errors.forbidden('Workspace membership is required.'));
      return;
    }
    if (!allowed.includes(role)) {
      next(errors.forbidden(`This action requires one of these roles: ${allowed.join(', ')}.`));
      return;
    }
    next();
  };
}
