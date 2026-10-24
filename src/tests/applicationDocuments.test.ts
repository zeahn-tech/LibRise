import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockSignedUrls = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    storage: {
      from: () => ({ upload: mockUpload, remove: mockRemove, createSignedUrls: mockSignedUrls })
    }
  })
}));

vi.mock('../services/authService', () => ({
  authService: {
    getSession: vi.fn(() => ({ user: { id: 'user-1', fullName: 'Test User' }, activeOrganization: { id: 'org-1' } })),
    can: vi.fn(() => true)
  }
}));

vi.mock('../services/notificationService', () => ({
  notificationService: {
    getOrganizationRecipientIds: vi.fn(async () => []),
    createAndDispatchNotification: vi.fn(),
    notifyApplicationUpdate: vi.fn(),
    notifyInterviewInvitation: vi.fn()
  }
}));

const pdf = (name = 'cv.pdf', size = 64) =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(size).fill(0x20)])], name, { type: 'application/pdf' });

function chain(result: { data: unknown; error: unknown }) {
  const b: any = {};
  for (const m of ['select', 'eq', 'update', 'insert']) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(() => Promise.resolve(result));
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

const baseApp = {
  id: 'app-1',
  opportunity_id: 'opp-1',
  applicant_user_id: 'user-1',
  organization_id: 'org-1',
  applicant_full_name: 'Jane Doe',
  applicant_email: 'jane@example.com',
  stage: 'applied',
  status: 'active',
  applied_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  history: [],
  opportunities: { title: 'Office Assistant' },
  organizations: { name: 'ZEahn Limited' }
};

const submitInput = {
  opportunityId: 'opp-1',
  opportunityTitle: 'Office Assistant',
  organizationName: 'ZEahn Limited',
  applicantName: 'Jane Doe',
  applicantEmail: 'jane@example.com'
} as any;

describe('application documents', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockRemove.mockReset().mockResolvedValue({ error: null });
    mockSignedUrls.mockReset();
  });

  it('dataUrlToFile rebuilds the original bytes, name and type', async () => {
    const { dataUrlToFile } = await import('../services/applicationDocumentService');
    const file = dataUrlToFile('data:application/pdf;base64,JVBERi0xLjQ=', 'Profile_CV.pdf')!;
    expect(file.name).toBe('Profile_CV.pdf');
    expect(file.type).toBe('application/pdf');
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe('%PDF-1.4');
    expect(dataUrlToFile('not a data url', 'x.pdf')).toBeNull();
  });

  it('prepareDocuments rejects executables, disguised files, empty files and too many credentials', async () => {
    const { prepareDocuments, MAX_CREDENTIAL_FILES } = await import('../services/applicationDocumentService');

    await expect(prepareDocuments([{ kind: 'cv', file: new File(['x'], 'run.exe') }])).rejects.toThrow(/run\.exe/);
    await expect(prepareDocuments([{ kind: 'cv', file: new File(['MZ not a pdf'], 'cv.pdf', { type: 'application/pdf' }) }])).rejects.toThrow(/do not match/);
    await expect(prepareDocuments([{ kind: 'cv', file: new File([], 'cv.pdf', { type: 'application/pdf' }) }])).rejects.toThrow(/empty/);
    await expect(
      prepareDocuments(Array.from({ length: MAX_CREDENTIAL_FILES + 1 }, (_, i) => ({ kind: 'credential' as const, file: pdf(`c${i}.pdf`) })))
    ).rejects.toThrow(/up to/);
    await expect(prepareDocuments([{ kind: 'cv', file: pdf('a.pdf') }, { kind: 'cv', file: pdf('b.pdf') }])).rejects.toThrow(/only one CV/i);

    const ok = await prepareDocuments([{ kind: 'cv', file: pdf() }]);
    expect(ok[0].fileName).toBe('cv.pdf');
    expect(ok[0].fileType).toBe('application/pdf');
  });

  it('submit(): requires a CV when requireCv is set, before touching Supabase', async () => {
    const { applicationService } = await import('../services/applicationService');
    const res = await applicationService.submit(submitInput, { requireCv: true, files: [] });
    expect(res.error).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('submit(): uploads files under <user>/<application>/ and stores only metadata + path (never a data URL)', async () => {
    const inserted: any[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === 'opportunities') return chain({ data: { id: 'opp-1', organization_id: 'org-1' }, error: null });
      const b = chain({ data: baseApp, error: null });
      b.insert = vi.fn((row: any) => {
        inserted.push(row);
        return b;
      });
      return b;
    });

    const { applicationService } = await import('../services/applicationService');
    const res = await applicationService.submit(
      { ...submitInput, resumeUrl: 'data:application/pdf;base64,AAAA' },
      { requireCv: true, files: [{ kind: 'cv', file: pdf('My CV.pdf') }, { kind: 'credential', file: pdf('degree.pdf') }] }
    );

    expect(res.error).toBeFalsy();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    const row = inserted[0];
    expect(row.documents).toHaveLength(2);
    for (const d of row.documents) expect(d.path.startsWith(`user-1/${row.id}/`)).toBe(true);
    expect(row.documents[0]).toMatchObject({ kind: 'cv', fileName: 'My_CV.pdf', fileType: 'application/pdf' });
    expect(row.cv_url).toBe(row.documents[0].path);
    expect(row.resume_file_name).toBe('My_CV.pdf');
    expect(row.resume_data_url).toBeNull();
    expect(row.resume_url).toBeNull(); // data URLs are never persisted
  });

  it('submit(): removes uploaded files if the application insert fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'opportunities') return chain({ data: { id: 'opp-1', organization_id: 'org-1' }, error: null });
      return chain({ data: null, error: { code: '23505', message: 'boom' } });
    });
    const { applicationService } = await import('../services/applicationService');
    const res = await applicationService.submit(submitInput, { files: [{ kind: 'cv', file: pdf() }] });

    expect(res.error).toBeTruthy();
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0][0][0]).toMatch(/^user-1\/app-/);
  });

  it('submit(): a failed upload cleans up earlier uploads and does not insert', async () => {
    mockUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'Bucket not found' } });
    const b = chain({ data: { id: 'opp-1', organization_id: 'org-1' }, error: null });
    mockFrom.mockReturnValue(b);

    const { applicationService } = await import('../services/applicationService');
    const res = await applicationService.submit(submitInput, {
      files: [{ kind: 'cv', file: pdf('a.pdf') }, { kind: 'credential', file: pdf('b.pdf') }]
    });

    expect(res.error?.message).toMatch(/not enabled/i);
    expect(b.insert).not.toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('getDocumentUrls(): maps signed URLs by path and skips unreadable ones', async () => {
    mockSignedUrls.mockResolvedValue({
      data: [
        { path: 'u/a/1.pdf', signedUrl: 'https://signed/1', error: null },
        { path: 'u/a/2.pdf', signedUrl: null, error: 'Object not found' }
      ],
      error: null
    });
    const { getDocumentUrls } = await import('../services/applicationDocumentService');
    const urls = await getDocumentUrls([
      { id: '1', kind: 'cv', fileName: '1.pdf', fileType: 'application/pdf', fileSize: 1, path: 'u/a/1.pdf' },
      { id: '2', kind: 'credential', fileName: '2.pdf', fileType: 'application/pdf', fileSize: 1, path: 'u/a/2.pdf' }
    ]);
    expect(urls).toEqual({ 'u/a/1.pdf': 'https://signed/1' });
  });
});
