import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockSignedUrls = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: mockFrom,
    rpc: vi.fn(),
    storage: { from: () => ({ upload: mockUpload, remove: mockRemove, createSignedUrls: mockSignedUrls }) }
  })
}));
vi.mock('../services/authService', () => ({
  authService: { getSession: vi.fn(() => ({ user: { id: 'user-1', fullName: 'Org Admin', email: 'a@b.com' } })), can: vi.fn(() => true) }
}));

const pdf = (name = 'lbr.pdf') =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(64).fill(0x20)])], name, { type: 'application/pdf' });

const requestRow = (docs: unknown[]) => ({
  id: 'vreq-1', entity_type: 'organization', entity_id: 'org-1', entity_name: 'Acme', submitter_user_id: 'user-1',
  submitter_name: 'Org Admin', submitter_email: 'a@b.com', status: 'pending_review', badge_requested: 'verified_company',
  county: 'Montserrado', evidence_documents: docs, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString()
});

function insertChain(result: { data: unknown; error: unknown }, inserted: any[]) {
  const b: any = {};
  b.insert = vi.fn((row: any) => { inserted.push(row); return b; });
  b.select = vi.fn(() => b);
  b.maybeSingle = vi.fn(() => Promise.resolve(result));
  return b;
}

const submitArgs = {
  entityType: 'organization' as const, entityId: 'org-1', entityName: 'Acme',
  badgeRequested: 'verified_company' as const, county: 'Montserrado'
};

describe('verification documents', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockRemove.mockReset().mockResolvedValue({ error: null });
    mockSignedUrls.mockReset();
  });

  it('rejects disguised, empty and excess files before uploading anything', async () => {
    const { prepareVerificationDocuments, MAX_VERIFICATION_FILES } = await import('../services/verificationDocumentService');
    await expect(prepareVerificationDocuments([{ file: new File(['MZ nope'], 'a.pdf', { type: 'application/pdf' }), documentType: 'other' }])).rejects.toThrow(/do not match/);
    await expect(prepareVerificationDocuments([{ file: new File([], 'a.pdf', { type: 'application/pdf' }), documentType: 'other' }])).rejects.toThrow(/empty/);
    await expect(prepareVerificationDocuments([{ file: new File(['x'], 'a.exe'), documentType: 'other' }])).rejects.toThrow();
    await expect(
      prepareVerificationDocuments(Array.from({ length: MAX_VERIFICATION_FILES + 1 }, (_, i) => ({ file: pdf(`f${i}.pdf`), documentType: 'other' as const })))
    ).rejects.toThrow(/up to/);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('submitVerificationRequest uploads under <uid>/<request id>/ and stores metadata with the storage path', async () => {
    const inserted: any[] = [];
    mockFrom.mockImplementation(() => insertChain({ data: requestRow([]), error: null }, inserted));
    const { trustSafetyService } = await import('../services/trustSafetyService');
    await trustSafetyService.submitVerificationRequest({ ...submitArgs, files: [{ file: pdf('LBR Cert.pdf'), documentType: 'lbr_certificate' }] });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const row = inserted[0];
    expect(row.entity_id).toBe('org-1');
    expect(row.evidence_documents).toHaveLength(1);
    const doc = row.evidence_documents[0];
    expect(doc.path.startsWith(`user-1/${row.id}/`)).toBe(true);
    expect(doc).toMatchObject({ documentType: 'lbr_certificate', fileName: 'LBR_Cert.pdf', fileType: 'application/pdf', urlOrData: '' });
  });

  it('removes uploaded files if the request insert fails', async () => {
    mockFrom.mockImplementation(() => insertChain({ data: null, error: { code: 'XX000', message: 'boom' } }, []));
    const { trustSafetyService } = await import('../services/trustSafetyService');
    await expect(
      trustSafetyService.submitVerificationRequest({ ...submitArgs, files: [{ file: pdf(), documentType: 'other' }] })
    ).rejects.toBeTruthy();
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0][0][0]).toMatch(/^user-1\/vreq-/);
  });

  it('getVerificationDocumentUrls maps signed URLs by path and skips unreadable files', async () => {
    mockSignedUrls.mockResolvedValue({
      data: [{ path: 'u/r/1.pdf', signedUrl: 'https://signed/1', error: null }, { path: 'u/r/2.pdf', signedUrl: null, error: 'denied' }],
      error: null
    });
    const { getVerificationDocumentUrls } = await import('../services/verificationDocumentService');
    expect(await getVerificationDocumentUrls([{ path: 'u/r/1.pdf' }, { path: 'u/r/2.pdf' }, {}])).toEqual({ 'u/r/1.pdf': 'https://signed/1' });
  });

  it('verificationService.submit reuses the evidence request id and stores file metadata on the audit', async () => {
    const inserted: any[] = [];
    mockFrom.mockImplementation(() =>
      insertChain({ data: { id: 'vreq-9', organization_id: 'org-1', requested_by_user_id: 'user-1', status: 'pending', requested_badge: 'verified_company', documents_submitted: [], created_at: new Date().toISOString(), organizations: { name: 'Acme', type: 'ngo', county: 'Montserrado' } }, error: null }, inserted)
    );
    const { verificationService } = await import('../services/verificationService');
    const doc = { id: 'vdoc-1', fileName: 'lbr.pdf', fileType: 'application/pdf', documentType: 'lbr_certificate' as const, fileSize: 10, urlOrData: '', path: 'user-1/vreq-9/vdoc-1-lbr.pdf', uploadedAt: new Date().toISOString() };
    await verificationService.submit({
      organizationId: 'org-1', organizationName: 'Acme', organizationType: 'ngo', county: 'Montserrado' as any,
      registryNumber: 'LBR-1', taxIdNumber: 'TIN-1', badgeRequested: 'verified_company',
      documents: ['lbr.pdf'], documentFiles: [doc], linkedRequestId: 'vreq-9'
    });
    expect(inserted[0].id).toBe('vreq-9');
    expect(inserted[0].documents_submitted[0].path).toBe(doc.path);
  });
});
