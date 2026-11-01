import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { deleteAccount, BUCKETS, type AccountDeletionDeps, type StoragePaths } from '../../server/accountDeletion';

const PATHS: StoragePaths = { applicationDocuments: ['u1/app-1/cv.pdf'], verificationDocuments: ['u1/vreq-1/lbr.pdf'], messageAttachments: ['conv-1/msg-1/photo.png'] };

function makeDeps(over: Partial<AccountDeletionDeps> = {}) {
  const calls: string[] = [];
  const deps: AccountDeletionDeps = {
    userId: 'u1',
    verifyPassword: vi.fn(async () => { calls.push('verifyPassword'); return { ok: true }; }),
    getBlockers: vi.fn(async () => { calls.push('getBlockers'); return { data: [], error: null }; }),
    getStoragePaths: vi.fn(async () => { calls.push('getStoragePaths'); return { data: PATHS, error: null }; }),
    deleteAccountData: vi.fn(async () => { calls.push('deleteAccountData'); return { error: null }; }),
    listFiles: vi.fn(async (bucket: string) => { calls.push(`list:${bucket}`); return { paths: [], error: null }; }),
    removeFiles: vi.fn(async (bucket: string, paths: string[]) => { calls.push(`remove:${bucket}:${paths.length}`); return { error: null }; }),
    deleteAuthUser: vi.fn(async () => { calls.push('deleteAuthUser'); return { error: null }; }),
    ...over
  };
  return { deps, calls };
}

const ok = { confirm: 'DELETE', password: 'correct horse' };

describe('deleteAccount (server step)', () => {
  it('refuses without the typed confirmation or a password, before doing anything', async () => {
    const { deps, calls } = makeDeps();
    expect((await deleteAccount(deps, { confirm: 'delete', password: 'x' })).status).toBe(400);
    expect((await deleteAccount(deps, { confirm: undefined, password: 'x' })).status).toBe(400);
    expect((await deleteAccount(deps, { confirm: 'DELETE', password: '' })).status).toBe(400);
    expect((await deleteAccount(deps, { confirm: 'DELETE', password: 123 })).status).toBe(400);
    expect((await deleteAccount(deps, { confirm: 'DELETE', password: 'x'.repeat(300) })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('a wrong password stops everything: nothing is read or deleted', async () => {
    const { deps, calls } = makeDeps({ verifyPassword: vi.fn(async () => ({ ok: false })) });
    const r = await deleteAccount(deps, ok);
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/incorrect password/i);
    expect(calls).toEqual([]);
  });

  it('reports blockers (409) and changes nothing', async () => {
    const blockers = [{ code: 'organization_owner', message: 'You are the only owner of Acme.' }];
    const { deps, calls } = makeDeps({ getBlockers: vi.fn(async () => ({ data: blockers, error: null })) });
    const r = await deleteAccount(deps, ok);
    expect(r.status).toBe(409);
    expect(r.body.blockers).toEqual(blockers);
    expect(r.body.error).toBe('You are the only owner of Acme.');
    expect(calls).not.toContain('deleteAccountData');
    expect(calls.some((c) => c.startsWith('remove:'))).toBe(false);
  });

  it('maps a suspended/inactive account (42501) to 403 and a failed pre-check to 502, both without changes', async () => {
    let { deps, calls } = makeDeps({ getBlockers: vi.fn(async () => ({ data: null, error: { code: '42501', message: 'This account is suspended.' } })) });
    expect((await deleteAccount(deps, ok)).status).toBe(403);
    expect(calls).not.toContain('deleteAccountData');
    ({ deps, calls } = makeDeps({ getBlockers: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'boom' } })) }));
    expect((await deleteAccount(deps, ok)).status).toBe(502);
    expect(calls).not.toContain('deleteAccountData');
    ({ deps, calls } = makeDeps({ getStoragePaths: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) }));
    expect((await deleteAccount(deps, ok)).status).toBe(502);
    expect(calls).not.toContain('deleteAccountData');
  });

  it('if the database step fails, no file is removed and the sign-in account is kept', async () => {
    for (const [code, status] of [['22023', 409], ['42501', 403], ['XX000', 502]] as const) {
      const { deps, calls } = makeDeps({ deleteAccountData: vi.fn(async () => ({ error: { code, message: 'nope' } })) });
      const r = await deleteAccount(deps, ok);
      expect(r.status).toBe(status);
      expect(r.body.success).toBe(false);
      expect(calls.some((c) => c.startsWith('remove:') || c === 'deleteAuthUser')).toBe(false);
    }
  });

  it('on success: password first, then checks, then the database, and only then files and the sign-in account', async () => {
    const { deps, calls } = makeDeps();
    const r = await deleteAccount(deps, ok);
    expect(r).toEqual({ status: 200, body: { success: true, warnings: [] } });
    const order = (name: string) => calls.findIndex((c) => c === name || c.startsWith(name));
    expect(order('verifyPassword')).toBeLessThan(order('getBlockers'));
    expect(order('getBlockers')).toBeLessThan(order('getStoragePaths'));
    expect(order('getStoragePaths')).toBeLessThan(order('deleteAccountData'));
    expect(order('deleteAccountData')).toBeLessThan(order('remove:'));
    expect(calls[calls.length - 1]).toBe('deleteAuthUser');
    expect(calls).toContain(`remove:${BUCKETS.applicationDocuments}:1`);
    expect(calls).toContain(`remove:${BUCKETS.verificationDocuments}:1`);
    expect(calls).toContain(`remove:${BUCKETS.messageAttachments}:1`);
  });

  it('also removes leftover files found in the person’s own folders, without duplicates, in chunks of 100', async () => {
    const leftovers = Array.from({ length: 230 }, (_, i) => `u1/orphan/f${i}.pdf`);
    const removed: Array<[string, string[]]> = [];
    const { deps } = makeDeps({
      listFiles: vi.fn(async (bucket: string) => ({ paths: bucket === BUCKETS.applicationDocuments ? [...leftovers, 'u1/app-1/cv.pdf'] : [], error: null })),
      removeFiles: vi.fn(async (bucket: string, paths: string[]) => { removed.push([bucket, paths]); return { error: null }; })
    });
    await deleteAccount(deps, ok);
    const appDocs = removed.filter(([b]) => b === BUCKETS.applicationDocuments);
    expect(appDocs.map(([, p]) => p.length)).toEqual([100, 100, 31]); // 230 orphans + 1 known path (de-duplicated)
    expect(new Set(appDocs.flatMap(([, p]) => p)).size).toBe(231);
  });

  it('clean-up problems after the point of no return are reported as warnings, never as failure or silent success', async () => {
    const { deps } = makeDeps({
      listFiles: vi.fn(async () => ({ paths: [], error: { message: 'list failed' } })),
      removeFiles: vi.fn(async () => ({ error: { message: 'remove failed' } })),
      deleteAuthUser: vi.fn(async () => ({ error: { message: 'auth failed' } }))
    });
    const r = await deleteAccount(deps, ok);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.warnings!.join(' ')).toMatch(/list failed/);
    expect(r.body.warnings!.join(' ')).toMatch(/remove failed/);
    expect(r.body.warnings!.join(' ')).toMatch(/auth failed.*already disabled/);
  });

  it('is wired into the server behind authentication and a rate limit, using server-only credentials', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/app\.post\('\/api\/account\/delete', accountDeletionLimiter, authenticateSession/);
    expect(server).toContain("caller.rpc('delete_my_account')");
    expect(server).toContain('admin.auth.admin.deleteUser(userId)');
    expect(readFileSync('server/accountDeletion.ts', 'utf8')).not.toMatch(/SERVICE_ROLE|process\.env/);
  });
});
