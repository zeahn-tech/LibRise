/**
 * Shared translation of unexpected database/PostgREST errors.
 *
 * Services used to rethrow these as a bare `new Error(message)`, which the API
 * layer (apiClient) reports as the useless "An unexpected system error
 * occurred." and which hid the real cause (a missing grant, an unapplied
 * migration, an expired session...). Everything now becomes an AppError that
 * carries an actionable message plus the technical detail in `details`, and the
 * raw error is always logged for diagnosis.
 */
import { AppError, ForbiddenError, UnauthorizedError } from '../core/errors/AppError';
import { logger } from '../core/logging/logger';

export interface DbErrorLike {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** SQLSTATE / PostgREST codes meaning a migration has not been applied (missing column / table / function). */
const SCHEMA_DRIFT_CODES = new Set(['42703', '42P01', '42883', '23502', 'PGRST202', 'PGRST204', 'PGRST205']);

/**
 * 42501 is used for BOTH "row-level security refused this row" and
 * "permission denied for function/table/column ..." (a missing GRANT). The
 * second kind is a deployment problem, not something the person did wrong, so
 * it must not be reported as "you do not have permission".
 */
export function isGrantProblem(error: DbErrorLike): boolean {
  return (
    error.code === '42501' &&
    /permission denied for (function|table|schema|sequence|relation|column)/i.test(error.message)
  );
}

export function toDbError(service: string, error: DbErrorLike): AppError {
  logger.error('DB', `[${service}] database error`, { code: error.code, message: error.message, details: error.details, hint: error.hint });
  const details = { dbCode: error.code, dbMessage: error.message };

  if (error.code === '28000' || error.code === 'PGRST301' || /jwt (expired|invalid)/i.test(error.message)) {
    return new UnauthorizedError('Your session has expired. Please sign in again.');
  }
  if (isGrantProblem(error)) {
    return new AppError(
      "This part of the platform isn't fully set up on the server yet (a database permission update is pending). Please contact support.",
      'SETUP_INCOMPLETE',
      503,
      details
    );
  }
  if (error.code === '42501') {
    return new ForbiddenError('You do not have permission to perform this action.');
  }
  if (error.code && SCHEMA_DRIFT_CODES.has(error.code)) {
    return new AppError(
      "This part of the platform isn't fully set up on the server yet (a database update is pending). Please contact support.",
      'SETUP_INCOMPLETE',
      503,
      details
    );
  }
  return new AppError(
    `We couldn't complete that request${error.code ? ` (error ${error.code})` : ''}. Please try again, and contact support if it keeps happening.`,
    'DATABASE_ERROR',
    500,
    details
  );
}
