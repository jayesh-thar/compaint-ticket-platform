export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'EMAIL_NOT_VERIFIED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'ASSIGNEE_NOT_ELIGIBLE'
  | 'OPEN_SUBTICKETS'
  | 'LAST_ADMIN'
  | 'ALREADY_MEMBER'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly fields?: Record<string, string>;

  constructor(statusCode: number, code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * True when Prisma rejected a write because a UNIQUE constraint was hit (P2002).
 * Used to turn "two people did the same thing at the same moment" into a clean 409.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
