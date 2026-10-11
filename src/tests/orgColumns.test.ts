import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ORG_PUBLIC_COLUMNS } from '../services/orgColumns';

const PRIVATE = ['settings', 'registration_number', 'tax_id_number', 'contact_email', 'contact_phone'];

describe('organization public column list (F-08)', () => {
  const migration = readFileSync(
    join(__dirname, '../../supabase/migrations/20261012120000_restrict_organization_private_columns.sql'),
    'utf8'
  );
  const grant = migration.match(/grant select \(([\s\S]*?)\) on public\.organizations/i);
  const granted = grant![1].split(',').map((c) => c.trim()).filter(Boolean).sort();
  const client = ORG_PUBLIC_COLUMNS.split(',').sort();

  it('matches the column-level GRANT in the migration exactly', () => {
    expect(client).toEqual(granted);
  });

  it('never includes a private column', () => {
    for (const c of PRIVATE) expect(client).not.toContain(c);
  });

  it('is also the literal used by the opportunity embed', () => {
    const src = readFileSync(join(__dirname, '../services/opportunityService.ts'), 'utf8');
    expect(src).toContain(`organizations(${ORG_PUBLIC_COLUMNS})`);
    expect(src).not.toContain('organizations(*)');
  });
});
