import React, { useRef, useState } from 'react';
import { AlertCircle, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { validateUploadedFile, verifyFileSignature, type FileCategory } from '../../core/security/fileValidator';
import { MAX_CREDENTIAL_FILES, MAX_CV_FILES } from '../../services/applicationDocumentService';
import { formatFileSize } from '../messaging/AttachmentViews';

export type CvSource = 'profile' | 'upload';
export interface CvEntry {
  file: File;
  source: CvSource;
}

interface Props {
  cvLabel: string;
  cvRequired: boolean;
  cvFiles: CvEntry[];
  onCvFilesChange: (files: CvEntry[]) => void;
  credentials: File[];
  onCredentialsChange: (files: File[]) => void;
  disabled?: boolean;
}

const CV_ACCEPT = '.pdf,.doc,.docx,.rtf,.txt';
const CREDENTIAL_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

/** Validates one picked file the same way the service will (extension, MIME, size, magic bytes). */
async function checkFile(file: File, category: FileCategory): Promise<string | null> {
  const v = validateUploadedFile(file, category);
  if (!v.valid) return `${file.name}: ${v.error}`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  const sig = await verifyFileSignature(file, v.cleanFileName.split('.').pop()!);
  return sig ? `${file.name}: ${sig}` : null;
}

const FileRow: React.FC<{
  icon: React.ReactNode;
  name: string;
  meta: string;
  onRemove: () => void;
  disabled?: boolean;
}> = ({ icon, name, meta, onRemove, disabled }) => (
  <li className="p-3 bg-white rounded-xl border border-[#D9E3D5] flex items-center gap-3 min-w-0">
    <span className="shrink-0">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-[#283618] truncate">{name}</p>
      <p className="text-[11px] text-[#606C38] truncate">{meta}</p>
    </div>
    <button
      type="button"
      disabled={disabled}
      onClick={onRemove}
      aria-label={`Remove ${name}`}
      className="shrink-0 min-w-11 min-h-11 flex items-center justify-center rounded-xl text-red-700 hover:bg-red-50 disabled:opacity-40 cursor-pointer"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </li>
);

/**
 * One multi-file section (CV or supporting documents).
 *
 * The native input is `hidden` (display:none) and opened through a keyboard-accessible label. A visually-hidden
 * but absolutely-positioned input is NOT used: focusing it makes the browser scroll the surrounding modal to
 * reveal it, which made the whole dialog jump off-screen every time the picker opened.
 */
const FileSection: React.FC<{
  title: React.ReactNode;
  hint: string;
  accept: string;
  max: number;
  category: FileCategory;
  addLabel: string;
  items: { key: string; file: File; meta: string }[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  icon: React.ReactNode;
  disabled?: boolean;
  dropzone?: boolean;
}> = ({ title, hint, accept, max, category, addLabel, items, onAdd, onRemove, icon, disabled, dropzone }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (picked.length === 0) return;

    const room = max - items.length;
    if (room <= 0) {
      setError(`You can attach up to ${max} files here.`);
      return;
    }
    const accepted: File[] = [];
    let firstError: string | null = null;
    for (const file of picked.slice(0, room)) {
      if ([...items.map((i) => i.file), ...accepted].some((f) => f.name === file.name && f.size === file.size)) continue;
      const err = await checkFile(file, category);
      if (err) firstError = firstError ?? err;
      else accepted.push(file);
    }
    if (!firstError && picked.length > room) firstError = `Only ${max} files are allowed here; extra files were skipped.`;
    setError(firstError);
    if (accepted.length > 0) onAdd(accepted);
  };

  const trigger = (content: React.ReactNode, className: string) => (
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
      className={`${className} ${disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
    >
      {content}
    </div>
  );

  return (
    <div>
      <div className="text-xs font-semibold text-[#283618] mb-1">{title}</div>
      <p className="text-[11px] text-[#606C38] mb-2">{hint}</p>

      {items.length > 0 && (
        <ul className="space-y-2 mb-2">
          {items.map((item, idx) => (
            <FileRow
              key={item.key}
              icon={icon}
              name={item.file.name}
              meta={`${formatFileSize(item.file.size)} · ${item.meta}`}
              onRemove={() => {
                setError(null);
                onRemove(idx);
              }}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      {items.length < max &&
        (dropzone && items.length === 0
          ? trigger(
              <>
                <Upload className="w-5 h-5 text-[#4F772D]" />
                <span className="text-xs font-bold text-[#283618]">{addLabel}</span>
              </>,
              'flex flex-col items-center justify-center gap-1 p-4 text-center bg-white rounded-xl border-2 border-dashed border-[#D9E3D5] hover:border-[#4F772D]'
            )
          : trigger(
              <>
                <Paperclip className="w-3.5 h-3.5" /> {addLabel}
              </>,
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl text-xs font-bold border bg-white border-[#D9E3D5] text-[#283618] hover:bg-[#ECF3E9]'
            ))}

      <input ref={inputRef} type="file" multiple accept={accept} onChange={handlePick} disabled={disabled} className="hidden" tabIndex={-1} />

      {error && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
        </p>
      )}
    </div>
  );
};

/** Applicant-side pickers: up to MAX_CV_FILES CV/primary files and up to MAX_CREDENTIAL_FILES supporting documents. */
export const ApplicationDocumentsPicker: React.FC<Props> = ({
  cvLabel,
  cvRequired,
  cvFiles,
  onCvFilesChange,
  credentials,
  onCredentialsChange,
  disabled
}) => (
  <div className="space-y-5">
    <FileSection
      title={
        <>
          {cvLabel} {cvRequired && <span className="text-[#BC6C25]">*</span>}
        </>
      }
      hint={`Up to ${MAX_CV_FILES} files; PDF, DOC, DOCX, RTF or TXT, max 5 MB each.`}
      accept={CV_ACCEPT}
      max={MAX_CV_FILES}
      category="cv"
      addLabel={cvFiles.length === 0 ? 'Tap to upload' : 'Add another'}
      dropzone
      icon={<FileText className="w-5 h-5 text-[#4F772D]" />}
      items={cvFiles.map((c, i) => ({ key: `${c.file.name}-${c.file.size}-${i}`, file: c.file, meta: c.source === 'profile' ? 'From your profile' : 'Uploaded now' }))}
      onAdd={(files) => onCvFilesChange([...cvFiles, ...files.map((file) => ({ file, source: 'upload' as const }))])}
      onRemove={(idx) => onCvFilesChange(cvFiles.filter((_, i) => i !== idx))}
      disabled={disabled}
    />
    <FileSection
      title={
        <>
          Supporting Documents <span className="font-normal text-[#606C38]">(optional)</span>
        </>
      }
      hint={`Certificates, transcripts, references or ID. Up to ${MAX_CREDENTIAL_FILES} files; PDF, DOC, DOCX, PNG or JPG, max 10 MB each.`}
      accept={CREDENTIAL_ACCEPT}
      max={MAX_CREDENTIAL_FILES}
      category="document"
      addLabel="Add documents"
      icon={<Paperclip className="w-4 h-4 text-[#4F772D]" />}
      items={credentials.map((file, i) => ({ key: `${file.name}-${file.size}-${i}`, file, meta: 'Ready to upload' }))}
      onAdd={(files) => onCredentialsChange([...credentials, ...files])}
      onRemove={(idx) => onCredentialsChange(credentials.filter((_, i) => i !== idx))}
      disabled={disabled}
    />
  </div>
);
