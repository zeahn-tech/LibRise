import { describe, it, expect } from 'vitest';
import { toDbError, isGrantProblem } from '../services/dbErrors';
import { ForbiddenError, UnauthorizedError } from '../core/errors/AppError';

describe('dbErrors', () => {
  it('tells a missing GRANT apart from a row-level-security refusal', () => {
    expect(isGrantProblem({ code: '42501', message: 'permission denied for function is_org_member' })).toBe(true);
    expect(isGrantProblem({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
  });

  it('never reports a grant problem as "you lack permission"', () => {
    const e = toDbError('x', { code: '42501', message: 'permission denied for table organizations' });
    expect(e).not.toBeInstanceOf(ForbiddenError);
    expect(e.code).toBe('SETUP_INCOMPLETE');
  });

  it('maps RLS refusals, expired sessions and unknown errors to actionable AppErrors', () => {
    expect(toDbError('x', { code: '42501', message: 'row-level security' })).toBeInstanceOf(ForbiddenError);
    expect(toDbError('x', { message: 'JWT expired' })).toBeInstanceOf(UnauthorizedError);
    const unknown = toDbError('x', { code: 'XX000', message: 'boom' });
    expect(unknown.message).toMatch(/XX000/);
    expect(unknown.message).not.toMatch(/unexpected system error/i);
  });
});
