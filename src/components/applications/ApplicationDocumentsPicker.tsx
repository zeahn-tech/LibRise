import React, { useId, useState } from 'react';
import { AlertCircle, FileText, Paperclip, RefreshCw, Trash2, Upload } from 'lucide-react';
import { validateUploadedFile, verifyFileSignature } from '../../core/security/fileValidator';
import { MAX_CREDENTIAL_FILES } from '../../services/applicationDocumentService';
import { formatFileSize } from '../messaging/AttachmentViews';

export type CvSource = 'profile' | 'upload';

interface Props {
  cvLabel: string;
  cvRequired: boolean;
  cvFile: File | null;
  cvSource: CvSource | null;
  onCvChange: (file: File | null, source: CvSource | null) => void;
  credentials: File[];
  onCredentialsChange: (files: File[]) => void;
  disabled?: boolean;
}

const CV_ACCEPT = '.pdf,.doc,.docx,.rtf,.txt';
const CREDENTIAL_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

/** Validates one picked file the same way the service will (extension, MIME, size, magic bytes). */
async function checkFile(file: File, category: 'cv' | 'document'): Promise<string | null> {
  const v = validateUploadedFile(file, category);
  if (!v.valid) return `${file.name}: ${v.error}`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  const sig = await verifyFileSignature(file, v.cleanFileName.split('.').pop()!);
  return sig ? `${file.name}: ${sig}` : null;
}

/**
 * Applicant-side file pickers: one CV (or primary document) and up to a few supporting credentials.
 * Uses <label>-wrapped file inputs (no programmatic click) so it works reliably in mobile browsers/PWAs.
 */
export const ApplicationDocumentsPicker: React.FC<Props> = ({
  cvLabel,
  cvRequired,
  cvFile,
  cvSource,
  onCvChange,
  credentials,
  onCredentialsChange,
  disabled
}) => {
  const cvInputId = useId();
  const credInputId = useId();
  const [cvError, setCvError] = useState<string | null>(null);
  const [credError, setCredError] = useState<string | null>(null);

  const handleCv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const error = await checkFile(file, 'cv');
    setCvError(error);
    if (!error) onCvChange(file, 'upload');
  };

  const handleCredentials = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_CREDENTIAL_FILES - credentials.length;
    if (room <= 0) {
      setCredError(`You can attach up to ${MAX_CREDENTIAL_FILES} supporting documents.`);
      return;
    }
    const accepted: File[] = [];
    let firstError: string | null = null;
    for (const file of picked.slice(0, room)) {
      const duplicate = [...credentials, ...accepted].some((f) => f.name === file.name && f.size === file.size);
      if (duplicate) continue;
      const error = await checkFile(file, 'document');
      if (error) firstError = firstError ?? error;
      else accepted.push(file);
    }
    if (!firstError && picked.length > room) {
      firstError = `Only ${MAX_CREDENTIAL_FILES} supporting documents are allowed; extra files were skipped.`;
    }
    setCredError(firstError);
    if (accepted.length > 0) onCredentialsChange([...credentials, ...accepted]);
  };

  const buttonTone =
    'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl text-xs font-bold border transition-colors cursor-pointer';
  const idleTone = disabled ? 'opacity-50 pointer-events-none' : '';

  return (
    <div className="space-y-4">
      {/* CV / primary document */}
      <div>
        <div className="text-xs font-semibold text-[#283618] mb-1">
          {cvLabel} {cvRequired && <span className="text-[#BC6C25]">*</span>}
        </div>

        {cvFile ? (
          <div className="p-3 bg-white rounded-xl border border-[#D9E3D5] flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#4F772D] shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#283618] truncate">{cvFile.name}</p>
              <p className="text-[11px] text-[#606C38]">
                {formatFileSize(cvFile.size)} · {cvSource === 'profile' ? 'From your profile' : 'Uploaded now'}
              </p>
            </div>
            <label
              htmlFor={cvInputId}
              className={`${buttonTone} ${idleTone} border-[#D9E3D5] text-[#283618] hover:bg-[#ECF3E9]`}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Replace
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setCvError(null);
                onCvChange(null, null);
              }}
              aria-label="Remove CV"
              className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-red-700 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label
            htmlFor={cvInputId}
            className={`flex flex-col items-center justify-center gap-1 p-4 text-center bg-white rounded-xl border-2 border-dashed border-[#D9E3D5] hover:border-[#4F772D] cursor-pointer ${idleTone}`}
          >
            <Upload className="w-5 h-5 text-[#4F772D]" />
            <span className="text-xs font-bold text-[#283618]">Tap to upload</span>
            <span className="text-[11px] text-[#606C38]">PDF, DOC, DOCX, RTF or TXT · max 5 MB</span>
          </label>
        )}
        <input
          id={cvInputId}
          type="file"
          accept={CV_ACCEPT}
          onChange={handleCv}
          disabled={disabled}
          className="sr-only"
        />
        {cvError && (
          <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {cvError}
          </p>
        )}
      </div>

      {/* Supporting credentials */}
      <div>
        <div className="text-xs font-semibold text-[#283618] mb-1">
          Supporting Documents <span className="font-normal text-[#606C38]">(optional)</span>
        </div>
        <p className="text-[11px] text-[#606C38] mb-2">
          Certificates, transcripts, references or ID. Up to {MAX_CREDENTIAL_FILES} files; PDF, DOC, DOCX, PNG or JPG, max 10 MB each.
        </p>

        {credentials.length > 0 && (
          <ul className="space-y-2 mb-2">
            {credentials.map((file, idx) => (
              <li key={`${file.name}-${idx}`} className="p-3 bg-white rounded-xl border border-[#D9E3D5] flex items-center gap-3">
                <Paperclip className="w-4 h-4 text-[#4F772D] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#283618] truncate">{file.name}</p>
                  <p className="text-[11px] text-[#606C38]">{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setCredError(null);
                    onCredentialsChange(credentials.filter((_, i) => i !== idx));
                  }}
                  aria-label={`Remove ${file.name}`}
                  className="min-w-11 min-h-11 flex items-center justify-center rounded-xl text-red-700 hover:bg-red-50 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {credentials.length < MAX_CREDENTIAL_FILES && (
          <label
            htmlFor={credInputId}
            className={`${buttonTone} ${idleTone} bg-white border-[#D9E3D5] text-[#283618] hover:bg-[#ECF3E9]`}
          >
            <Paperclip className="w-3.5 h-3.5" /> Add documents
          </label>
        )}
        <input
          id={credInputId}
          type="file"
          multiple
          accept={CREDENTIAL_ACCEPT}
          onChange={handleCredentials}
          disabled={disabled}
          className="sr-only"
        />
        {credError && (
          <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {credError}
          </p>
        )}
      </div>
    </div>
  );
};
