import { z } from 'zod';
import { errors } from '../lib/errors.js';

export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message = 'Invalid request.',
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw errors.validation(
      message,
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}
