import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 20261012190000 made is_account_suspended(uuid) non-executable for signed-in users and introduced the self-only
 * current_account_suspended(). A restrictive policy that still calls the old function makes EVERY signed-in read of
 * that table fail with "permission denied for function is_account_suspended". (This happened to platform_settings:
 * the announcement banner never reached signed-in people.) Later migrations must use the wrapper.
 */
describe('migrations: suspended-account policies', () => {
  const dir = 'supabase/migrations';
  const later = readdirSync(dir).filter((f) => f.endsWith('.sql') && f > '20261012190000');

  it('no later migration creates a policy that calls is_account_suspended()', () => {
    const offenders: string[] = [];
    for (const f of later) {
      const sql = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
      // every CREATE POLICY ... ; statement
      for (const m of sql.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (/is_account_suspended\s*\(/i.test(m[0])) offenders.push(`${f}: ${m[0].slice(0, 80).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('later restrictive policies use the self-only wrapper', () => {
    const files = later.filter((f) => /restrict_suspended_accounts/.test(readFileSync(join(dir, f), 'utf8')));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).toMatch(/current_account_suspended\s*\(\)/);
  });
});
