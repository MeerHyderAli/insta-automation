import type { NextFunction, Request, Response } from 'express';
import type { AuthVerifier } from '../auth/verifier.js';
import { errors } from '../lib/errors.js';

/** Bearer-token authentication. Returns 401 before any tenant data is read. */
export function requireAuth(verifier: AuthVerifier) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('authorization');
      if (!header) throw errors.unauthenticated();
      const match = /^Bearer\s+(.+)$/i.exec(header);
      const token = match?.[1]?.trim();
      if (!token) throw errors.unauthenticated();
      req.user = await verifier.verify(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}
