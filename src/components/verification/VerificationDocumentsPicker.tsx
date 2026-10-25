import React, { useRef, useState } from 'react';
import { AlertCircle, FileText, Trash2, UploadCloud } from 'lucide-react';
import { validateUploadedFile, verifyFileSignature } from '../../core/security/fileValidator';
import {
  MAX_VERIFICATION_FILES,
  VERIFICATION_DOCUMENT_TYPE_LABELS,
  type PendingVerificationDocument
} from '../../services/verificationDocumentService';
import type { VerificationDocumentType } from '../../types';
import { formatFileSize } from '../messaging/AttachmentViews';

interface Props {
  documents: PendingVerificationDocument[];
  onChange: (docs: PendingVerificationDocument[]) => void;
  disabled?: boolean;
}

/** Guess a sensible default document type from the file name so most applicants don't need to change it. */
function guessType(name: string): VerificationDocumentType {
  const n = name.toLowerCase();
  if (/(tax|lra|tin)/.test(n)) return 'tax_clearance';
  if (/(mofa|accredit)/.test(n)) return 'mofa_accreditation';
  if (/(labou?r|permit|licen[cs]e)/.test(n)) return 'hr_license';
  if (/(owner|deed|title)/.test(n)) return 'ownership_proof';
  if (/(passport|national|\bid\b)/.test(n)) return 'national_id';
  if (/(lbr|registry|registration|incorporat|certificate)/.test(n)) return 'lbr_certificate';
  return 'other';
}

/**
 * Picker for statutory evidence. The native input is display:none and opened via an accessible button, so focusing
 * it can never scroll the page (a visually-hidden absolutely-positioned input made dialogs jump).
 */
export const VerificationDocumentsPicker: React.FC<Props> = ({ documents, onChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;

    const room = MAX_VERIFICATION_FILES - documents.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_VERIFICATION_FILES} documents.`);
      return;
    }
    const accepted: PendingVerificationDocument[] = [];
    let firstError: string | null = null;
    for (const file of picked.slice(0, room)) {
      if ([...documents, ...accepted].some((d) => d.file.name === file.name && d.file.size === file.size)) continue;
      const v = validateUploadedFile(file, 'document');
      if (!v.valid) {
        firstError = firstError ?? `${file.name}: ${v.error}`;
        continue;
      }
      if (file.size === 0) {
        firstError = firstError ?? `${file.name}: the file is empty.`;
        continue;
      }
      const sig = await verifyFileSignature(file, v.cleanFileName.split('.').pop()!);
      if (sig) {
        firstError = firstError ?? `${file.name}: ${sig}`;
        continue;
      }
      accepted.push({ file, documentType: guessType(file.name) });
    }
    if (!firstError && picked.length > room) firstError = `Only ${MAX_VERIFICATION_FILES} documents are allowed; extra files were skipped.`;
    setError(firstError);
    if (accepted.length > 0) onChange([...documents, ...accepted]);
  };

  return (
    <div className="space-y-3">
      {documents.length < MAX_VERIFICATION_FILES && (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              open();
            }
          }}
          className={`p-4 border-2 border-dashed border-[#D9E3D5] rounded-2xl bg-[#F9F8F4] text-center space-y-2 hover:border-[#4F772D] ${
            disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
          }`}
        >
          <UploadCloud className="w-6 h-6 text-[#A3B18A] mx-auto" />
          <div className="text-xs font-semibold text-[#283618]">
            {documents.length === 0 ? 'Tap to attach statutory proof documents' : 'Add more documents'}
          </div>
          <div className="text-[11px] text-[#A3B18A]">
            PDF, DOC, DOCX, PNG or JPG · max 10 MB each · up to {MAX_VERIFICATION_FILES} files. LBR certificate, LRA tax clearance, MOFA accreditation letter, Ministry of Labour HR permit.
          </div>
        </div>
      )}
      <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handlePick} disabled={disabled} className="hidden" tabIndex={-1} />

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-red-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
        </p>
      )}

      {documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((doc, idx) => (
            <li key={`${doc.file.name}-${doc.file.size}-${idx}`} className="p-3 bg-white rounded-xl border border-[#D9E3D5] space-y-2">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-5 h-5 text-[#4F772D] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#283618] truncate">{doc.file.name}</p>
                  <p className="text-[11px] text-[#606C38]">{formatFileSize(doc.file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setError(null);
                    onChange(documents.filter((_, i) => i !== idx));
                  }}
                  aria-label={`Remove ${doc.file.name}`}
                  className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-40 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <select
                aria-label={`Document type for ${doc.file.name}`}
                value={doc.documentType}
                disabled={disabled}
                onChange={(e) => onChange(documents.map((d, i) => (i === idx ? { ...d, documentType: e.target.value as VerificationDocumentType } : d)))}
                className="w-full min-h-11 text-xs p-2.5 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-[#283618] outline-none focus:border-[#4F772D]"
              >
                {Object.entries(VERIFICATION_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
