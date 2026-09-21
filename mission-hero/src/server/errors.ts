/**
 * Error taxonomy.
 *
 * `NOT_FOUND` deliberately covers both "does not exist" and "not yours"
 * (BR-58): telling an attacker that an id is real but belongs to another family
 * leaks the id space.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_POINTS'
  | 'NOT_ELIGIBLE'
  | 'INTERNAL';

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_POINTS: 409,
  NOT_ELIGIBLE: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Safe to show a user. Internal detail stays in `message`. */
  readonly publicMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { publicMessage?: string; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    this.publicMessage = options?.publicMessage ?? message;
    this.details = options?.details;
  }
}

export const unauthenticated = (message = 'Please sign in again.') =>
  new AppError('UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have access to this.') =>
  new AppError('FORBIDDEN', message);

/** Used for "not yours" as well as "not there" — see BR-58. */
export const notFound = (what = 'That could not be found.') => new AppError('NOT_FOUND', what);

export const validation = (message: string, details?: Record<string, unknown>) =>
  new AppError('VALIDATION', message, { details });

export const conflict = (message: string) => new AppError('CONFLICT', message);

export const insufficientPoints = (needed: number, balance: number) =>
  new AppError('INSUFFICIENT_POINTS', `Needs ${needed} points but has ${balance}.`, {
    publicMessage: `You need ${needed - balance} more points for this.`,
    details: { needed, balance },
  });

export const notEligible = (reason: string, publicMessage?: string) =>
  new AppError('NOT_ELIGIBLE', reason, { publicMessage: publicMessage ?? 'Not available yet.' });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Postgres unique-violation, surfaced by Prisma as P2002. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
