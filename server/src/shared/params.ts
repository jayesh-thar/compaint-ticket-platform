import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './errors.js';

const uuid = z.string().uuid();

/**
 * Route ids are UUIDs. A malformed id can never match a row, so we answer
 * exactly like "not found" (404) instead of a validation error.
 */
export const parseIdParam = (raw: unknown, what: string): string => {
  const result = uuid.safeParse(raw);
  if (!result.success) throw new AppError(404, 'NOT_FOUND', `${what} not found.`);
  return result.data;
};

/** Case-insensitive uniqueness key for team and category names. */
export const toNameKey = (name: string) => name.trim().toLowerCase();

/** `?includeArchived=true` on list endpoints (management screens). */
export const wantsArchived = (query: unknown) =>
  typeof query === 'object' && query !== null && (query as Record<string, unknown>).includeArchived === 'true';

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/**
 * Turns "return a value" into "send it as JSON with this status", and sends any
 * thrown error to the central error handler. Keeps controllers one line each.
 */
export const handle =
  (status: number, fn: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await fn(req, res);
      res.status(status).json(result);
    } catch (error) {
      next(error);
    }
  };
