import type { AuthUser } from '../auth/verifier.js';
import type { WorkspaceRecord, WorkspaceRole } from './domain.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      workspace?: WorkspaceRecord;
      membership?: { role: WorkspaceRole };
      requestId?: string;
      rawBody?: Buffer;
    }
  }
}

export {};
