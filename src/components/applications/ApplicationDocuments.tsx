import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, ExternalLink, Eye, FileText, Image as ImageIcon, Loader2, RefreshCw, X } from 'lucide-react';
import type { Application, ApplicationDocument, MessageAttachment } from '../../types';
import { applicationService } from '../../services/applicationService';
import {
  AttachmentLightbox,
  downloadAttachment,
  formatFileSize,
  isImageAttachment,
  isPdfAttachment
} from '../messaging/AttachmentViews';

interface Props {
  application: Pick<Application, 'documents' | 'resumeDataUrl' | 'resumeUrl' | 'resumeFileName'>;
  /** Tighter spacing for use inside cards. */
  compact?: boolean;
}

interface DocRow extends ApplicationDocument {
  /** Resolved signed URL (or legacy inline/external URL). */
  url?: string;
}

/** Applications submitted before document uploads existed may carry a single legacy resume link/data URL. */
function legacyDocument(app: Props['application']): ApplicationDocument | null {
  const url = app.resumeDataUrl || app.resumeUrl;
  if (!url || !/^(data:|https?:\/\/)/i.test(url)) return null;
  const name = app.resumeFileName || 'Resume.pdf';
  return { id: 'legacy-resume', kind: 'cv', fileName: name, fileType: /\.pdf$/i.test(name) ? 'application/pdf' : '', fileSize: 0, path: '' };
}

const toAttachment = (doc: DocRow): MessageAttachment => ({
  id: doc.id,
  fileName: doc.fileName,
  fileType: doc.fileType,
  fileSize: doc.fileSize,
  path: doc.path,
  urlOrBase64: doc.url || ''
});

/** In-app PDF viewer. Desktop gets an inline frame; touch devices (where PDFs can't render inline) get open/download. */
const PdfPreviewModal: React.FC<{ doc: DocRow; onClose: () => void }> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const canEmbed = useMemo(
    () => typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches && (navigator as any).pdfViewerEnabled !== false,
    []
  );

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(doc.url!);
        if (!res.ok) throw new Error(String(res.status));
        const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setBlobUrl(revoked);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc.url, onClose]);

  const [downloading, setDownloading] = useState(false);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${doc.fileName}`} className="fixed inset-0 z-[60] bg-black/85 flex flex-col">
      <div className="flex items-center justify-between gap-3 p-3 text-white">
        <p className="text-sm font-semibold truncate min-w-0">{doc.fileName}</p>
        <div className="flex items-center gap-1 shrink-0">
          {blobUrl && (
            <a href={blobUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in new tab" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10">
              <ExternalLink className="w-5 h-5" />
            </a>
          )}
          <button
            type="button"
            aria-label="Download"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try { await downloadAttachment(toAttachment(doc)); } finally { setDownloading(false); }
            }}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10"
          >
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 bg-white/5">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-white text-sm p-6 text-center">
            <AlertCircle className="w-6 h-6" /> This document could not be loaded. Close and try again.
          </div>
        ) : !blobUrl ? (
          <div className="h-full flex items-center justify-center text-white"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : canEmbed ? (
          <iframe title={doc.fileName} src={blobUrl} className="w-full h-full bg-white" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white text-sm p-6 text-center">
            <FileText className="w-10 h-10" />
            <p>Your device opens PDFs in its own viewer.</p>
            <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 min-h-11 px-5 rounded-xl bg-[#4F772D] font-bold text-white">
              <ExternalLink className="w-4 h-4" /> Open PDF
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Lists the files attached to an application with View + Download, for the hiring team and the applicant.
 * Images open in a zoomable lightbox, PDFs in an in-app viewer; Word/RTF/TXT files download with their real name.
 */
export const ApplicationDocuments: React.FC<Props> = ({ application, compact }) => {
  const legacy = useMemo(() => legacyDocument(application), [application]);
  const documents = useMemo<ApplicationDocument[]>(
    () => (application.documents && application.documents.length > 0 ? application.documents : legacy ? [legacy] : []),
    [application.documents, legacy]
  );

  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageDoc, setImageDoc] = useState<DocRow | null>(null);
  const [pdfDoc, setPdfDoc] = useState<DocRow | null>(null);

  const load = useCallback(async () => {
    const stored = documents.filter((d) => d.path);
    if (stored.length === 0) return;
    setLoading(true);
    setFailed(false);
    try {
      setUrls(await applicationService.getDocumentUrls(stored));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [documents]);

  useEffect(() => {
    void load();
  }, [load]);

  if (documents.length === 0) {
    return <p className="text-xs text-[#606C38]">No documents were attached to this application.</p>;
  }

  const rows: DocRow[] = documents.map((d) => ({
    ...d,
    url: d.path ? urls[d.path] : d.id === 'legacy-resume' ? application.resumeDataUrl || application.resumeUrl : undefined
  }));

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {failed && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">Documents could not be loaded.</span>
          <button type="button" onClick={load} className="inline-flex items-center gap-1 min-h-9 px-3 rounded-lg font-bold hover:bg-red-100 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {rows.map((doc) => {
        const att = toAttachment(doc);
        const image = isImageAttachment(att);
        const pdf = isPdfAttachment(att);
        const ready = !!doc.url;
        return (
          <div key={doc.id} className="p-3 bg-white rounded-xl border border-[#E8E4D9] flex items-center gap-3">
            {image ? <ImageIcon className="w-5 h-5 text-[#4F772D] shrink-0" /> : <FileText className="w-5 h-5 text-[#4F772D] shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#283618] truncate">{doc.fileName}</p>
              <p className="text-[11px] text-[#606C38]">
                {doc.kind === 'cv' ? 'CV / Primary document' : 'Supporting document'}
                {doc.fileSize > 0 && ` · ${formatFileSize(doc.fileSize)}`}
                {!ready && loading && ' · Loading…'}
              </p>
            </div>
            {(image || pdf) && (
              <button
                type="button"
                disabled={!ready}
                onClick={() => (image ? setImageDoc(doc) : setPdfDoc(doc))}
                aria-label={`View ${doc.fileName}`}
                className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold text-[#283618] border border-[#D9E3D5] hover:bg-[#ECF3E9] disabled:opacity-40 cursor-pointer"
              >
                <Eye className="w-4 h-4" /> <span className="hidden sm:inline">View</span>
              </button>
            )}
            <DownloadButton doc={doc} disabled={!ready} />
          </div>
        );
      })}

      {imageDoc && <AttachmentLightbox attachment={toAttachment(imageDoc)} onClose={() => setImageDoc(null)} />}
      {pdfDoc && <PdfPreviewModal doc={pdfDoc} onClose={() => setPdfDoc(null)} />}
    </div>
  );
};

const DownloadButton: React.FC<{ doc: DocRow; disabled: boolean }> = ({ doc, disabled }) => {
  const [busy, setBusy] = useState(false);
  return (
    <button
        type="button"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadAttachment(toAttachment(doc));
          } catch (e) {
            alert(e instanceof Error ? e.message : 'Download failed.');
          } finally {
            setBusy(false);
          }
        }}
        aria-label={`Download ${doc.fileName}`}
        className="inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-bold text-white bg-[#4F772D] hover:bg-[#283618] disabled:opacity-40 cursor-pointer"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        <span className="hidden sm:inline">Download</span>
    </button>
  );
};
