/**
 * applicationDocumentService.ts
 *
 * CV / credential uploads for job (and other opportunity) applications.
 *
 * Files live in the PRIVATE Supabase Storage bucket `application-documents`; the application row only keeps
 * metadata + the object path (applications.documents). Reads use short-lived signed URLs, and Storage RLS
 * (migration 20261024120000) lets only the applicant and the hiring organization read them.
 *
 * Object path: <applicant_user_id>/<application_id>/<document_id>-<file_name>
 */

import { getSupabaseClient } from '../lib/supabaseClient';
import { ValidationError } from '../core/errors/AppError';
import { validateUploadedFile, verifyFileSignature } from '../core/security/fileValidator';
import type { ApplicationDocument, ApplicationDocumentKind } from '../types';

export const APPLICATION_DOCUMENT_BUCKET = 'application-documents';
export const MAX_CREDENTIAL_FILES = 5;
export const MAX_CV_FILES = 4;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface PendingDocument {
  kind: ApplicationDocumentKind;
  file: File | Blob;
  /** Required for Blobs (e.g. a profile CV rebuilt from a data URL); Files already carry a name. */
  fileName?: string;
}

interface PreparedDocument {
  id: string;
  kind: ApplicationDocumentKind;
  file: File | Blob;
  fileName: string;
  fileType: string;
  fileSize: number;
  ext: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg'
};

function client() {
  const c = getSupabaseClient();
  if (!c) throw new ValidationError('File storage is not configured. Please try again later.');
  return c;
}

const newDocumentId = () => `doc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

/** Rebuilds a File from a `data:` URL (used for CVs saved on the candidate profile). Returns null if malformed. */
export function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = /^data:([^;,]*)((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  try {
    const raw = match[3] ? atob(match[4]) : decodeURIComponent(match[4]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return new File([bytes], fileName, { type: match[1] || MIME_BY_EXT[ext] || 'application/octet-stream' });
  } catch {
    return null;
  }
}

/** Validates every pending file (name, extension, MIME, size, magic bytes). Throws ValidationError on the first problem. */
export async function prepareDocuments(pending: PendingDocument[]): Promise<PreparedDocument[]> {
  const credentials = pending.filter((p) => p.kind === 'credential').length;
  if (credentials > MAX_CREDENTIAL_FILES) {
    throw new ValidationError(`You can attach up to ${MAX_CREDENTIAL_FILES} supporting documents.`);
  }
  if (pending.filter((p) => p.kind === 'cv').length > MAX_CV_FILES) {
    throw new ValidationError(`You can attach up to ${MAX_CV_FILES} CV / primary files.`);
  }

  const prepared: PreparedDocument[] = [];
  for (const item of pending) {
    const name = (item.file as File).name || item.fileName || '';
    const validation = validateUploadedFile(
      { name, type: item.file.type, size: item.file.size },
      item.kind === 'cv' ? 'cv' : 'document'
    );
    if (!validation.valid) throw new ValidationError(`${name || 'File'}: ${validation.error}`);
    if (item.file.size === 0) throw new ValidationError(`${validation.cleanFileName}: the file is empty.`);

    const ext = validation.cleanFileName.split('.').pop()!.toLowerCase();
    const sigError = await verifyFileSignature(item.file, ext);
    if (sigError) throw new ValidationError(`${validation.cleanFileName}: ${sigError}`);

    prepared.push({
      id: newDocumentId(),
      kind: item.kind,
      file: item.file,
      fileName: validation.cleanFileName,
      fileType: MIME_BY_EXT[ext] || validation.fileType,
      fileSize: item.file.size,
      ext
    });
  }
  return prepared;
}

/**
 * Uploads prepared files. On any failure the files already uploaded are removed and the error is rethrown,
 * so a failed submit never leaves orphans behind.
 */
export async function uploadDocuments(
  applicantUserId: string,
  applicationId: string,
  prepared: PreparedDocument[]
): Promise<ApplicationDocument[]> {
  const uploaded: string[] = [];
  const documents: ApplicationDocument[] = [];
  try {
    for (const doc of prepared) {
      const path = `${applicantUserId}/${applicationId}/${doc.id}-${doc.fileName}`;
      const { error } = await client()
        .storage.from(APPLICATION_DOCUMENT_BUCKET)
        .upload(path, doc.file, { contentType: doc.fileType, upsert: false, cacheControl: '3600' });
      if (error) {
        if (/bucket not found/i.test(error.message)) {
          throw new ValidationError('Document uploads are not enabled on this server yet. Please contact support.');
        }
        throw new ValidationError(`Could not upload ${doc.fileName}: ${error.message}`);
      }
      uploaded.push(path);
      documents.push({ id: doc.id, kind: doc.kind, fileName: doc.fileName, fileType: doc.fileType, fileSize: doc.fileSize, path });
    }
    return documents;
  } catch (err) {
    await removeDocuments(uploaded);
    throw err;
  }
}

export async function removeDocuments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client().storage.from(APPLICATION_DOCUMENT_BUCKET).remove(paths);
  } catch {
    /* best effort cleanup */
  }
}

/** Short-lived signed URLs keyed by storage path. Paths the caller cannot read are simply absent. */
export async function getDocumentUrls(documents: ApplicationDocument[]): Promise<Record<string, string>> {
  const paths = documents.map((d) => d.path).filter(Boolean);
  if (paths.length === 0) return {};
  const { data, error } = await client()
    .storage.from(APPLICATION_DOCUMENT_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  const urls: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls[row.path] = row.signedUrl;
  }
  return urls;
}
