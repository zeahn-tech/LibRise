import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '../../supabase/migrations');
const FILE = '20261118100000_dual_currency_payment_plans.sql';
const SQL = readFileSync(join(DIR, FILE), 'utf8');

describe('dual-currency migration (static checks; behaviour is covered by supabase/tests/dual_currency_payments_tests.sql)', () => {
  it('has a unique, latest timestamp', () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort();
    expect(names.filter((n) => n.startsWith('20261118100000'))).toHaveLength(1);
    expect(names[names.length - 1]).toBe(FILE);
  });
  it('never rewrites existing plan ids or prices (LRD rows are insert-only, do nothing on conflict)', () => {
    expect(SQL).toMatch(/u\.price_group \|\| '-lrd'/);
    expect(SQL).toMatch(/on conflict do nothing/);
    expect(SQL).not.toMatch(/update public\.payment_plans\s+set\s+id\b/i);
    expect(SQL).not.toMatch(/delete from public\.payment_plans/i);
  });
  it('does not hardcode the exchange rate except as the documented fallback', () => {
    expect(SQL.match(/195/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(SQL).toMatch(/platform_settings/);
  });
  it('restricts currencies, pairs plans per currency and protects plan currency', () => {
    expect(SQL).toMatch(/payment_plans_currency_check[\s\S]*'USD', 'LRD'/);
    expect(SQL).toMatch(/payments_currency_check/);
    expect(SQL).toMatch(/uq_payment_plans_price_group_currency/);
    expect(SQL).toMatch(/guard_payment_plan_currency/);
  });
  it('keeps the price-change RPC admin-only and audits price changes', () => {
    expect(SQL).toMatch(/is_platform_admin\(v_uid\)/);
    expect(SQL).toMatch(/revoke all on function public\.admin_set_payment_plan_price\(varchar, integer\) from public, anon/);
    expect(SQL).toMatch(/payment_plan_price_history/);
    expect(SQL).toMatch(/alter table public\.payment_plan_price_history enable row level security/);
  });
  it('does not touch the payment security functions or RLS policies on payments', () => {
    expect(SQL).not.toMatch(/create or replace function public\.(admin_review_payment|payments_enforce_server_pricing|submit_payment_reference)/);
    expect(SQL).not.toMatch(/on public\.payments\s+for (insert|update|delete)/i);
  });
});
