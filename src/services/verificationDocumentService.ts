/**
 * verificationDocumentService.ts
 *
 * Statutory evidence (LBR certificate, tax clearance, accreditation, ...) for verification requests.
 * Files live in the PRIVATE bucket `verification-documents`; verification_requests.evidence_documents keeps
 * metadata + the object path. Only the submitter, platform admins and verification officers can read them
 * (Storage RLS, migration 20261024140000). Reads use short-lived signed URLs.
 *
 * Object path: <submitter_user_id>/<verification_request_id>/<document_id>-<file_name>
 */

import { getSupabaseClient } from '../lib/supabaseClient';
import { ValidationError } from '../core/errors/AppError';
import { validateUploadedFile, verifyFileSignature } from '../core/security/fileValidator';
import type { VerificationDocumentType, VerificationEvidenceDocument } from '../types';

export const VERIFICATION_DOCUMENT_BUCKET = 'verification-documents';
export const MAX_VERIFICATION_FILES = 6;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface PendingVerificationDocument {
  file: File;
  documentType: VerificationDocumentType;
}

export const VERIFICATION_DOCUMENT_TYPE_LABELS: Record<VerificationDocumentType, string> = {
  lbr_certificate: 'LBR business certificate',
  tax_clearance: 'LRA tax clearance',
  mofa_accreditation: 'MOFA accreditation letter',
  hr_license: 'Ministry of Labour HR permit',
  ownership_proof: 'Proof of ownership',
  national_id: 'National ID',
  other: 'Other supporting document'
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg'
};

function client() {
  const c = getSupabaseClient();
  if (!c) throw new ValidationError('File storage is not configured. Please try again later.');
  return c;
}

interface Prepared extends PendingVerificationDocument {
  id: string;
  fileName: string;
  fileType: string;
}

/** Validates name, extension, MIME, size and magic bytes for every file. Throws ValidationError on the first problem. */
export async function prepareVerificationDocuments(pending: PendingVerificationDocument[]): Promise<Prepared[]> {
  if (pending.length > MAX_VERIFICATION_FILES) {
    throw new ValidationError(`You can attach up to ${MAX_VERIFICATION_FILES} documents.`);
  }
  const out: Prepared[] = [];
  for (const item of pending) {
    const v = validateUploadedFile(item.file, 'document');
    if (!v.valid) throw new ValidationError(`${item.file.name}: ${v.error}`);
    if (item.file.size === 0) throw new ValidationError(`${v.cleanFileName}: the file is empty.`);
    const ext = v.cleanFileName.split('.').pop()!.toLowerCase();
    const sig = await verifyFileSignature(item.file, ext);
    if (sig) throw new ValidationError(`${v.cleanFileName}: ${sig}`);
    out.push({
      ...item,
      id: `vdoc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      fileName: v.cleanFileName,
      fileType: MIME_BY_EXT[ext] || v.fileType
    });
  }
  return out;
}

/** Uploads prepared files; on any failure removes what was already uploaded and rethrows. */
export async function uploadVerificationDocuments(
  submitterUserId: string,
  requestId: string,
  prepared: Prepared[]
): Promise<VerificationEvidenceDocument[]> {
  const uploaded: string[] = [];
  const docs: VerificationEvidenceDocument[] = [];
  try {
    for (const p of prepared) {
      const path = `${submitterUserId}/${requestId}/${p.id}-${p.fileName}`;
      const { error } = await client()
        .storage.from(VERIFICATION_DOCUMENT_BUCKET)
        .upload(path, p.file, { contentType: p.fileType, upsert: false, cacheControl: '3600' });
      if (error) {
        if (/bucket not found/i.test(error.message)) {
          throw new ValidationError('Verification uploads are not enabled on this server yet. Please contact support.');
        }
        throw new ValidationError(`Could not upload ${p.fileName}: ${error.message}`);
      }
      uploaded.push(path);
      docs.push({
        id: p.id,
        fileName: p.fileName,
        fileType: p.fileType,
        documentType: p.documentType,
        fileSize: p.file.size,
        urlOrData: '',
        path,
        uploadedAt: new Date().toISOString()
      });
    }
    return docs;
  } catch (err) {
    await removeVerificationDocuments(uploaded);
    throw err;
  }
}

export async function removeVerificationDocuments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client().storage.from(VERIFICATION_DOCUMENT_BUCKET).remove(paths);
  } catch {
    /* best effort cleanup */
  }
}

/** Signed URLs keyed by storage path. Paths the caller may not read are simply absent. */
export async function getVerificationDocumentUrls(docs: { path?: string }[]): Promise<Record<string, string>> {
  const paths = docs.map((d) => d.path).filter((p): p is string => !!p);
  if (paths.length === 0) return {};
  const { data, error } = await client().storage.from(VERIFICATION_DOCUMENT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) urls[row.path] = row.signedUrl;
  return urls;
}
