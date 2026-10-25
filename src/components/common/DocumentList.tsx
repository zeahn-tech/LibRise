import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, ExternalLink, Eye, FileText, Image as ImageIcon, Loader2, RefreshCw, X } from 'lucide-react';
import type { MessageAttachment } from '../../types';
import {
  AttachmentLightbox,
  downloadAttachment,
  formatFileSize,
  isImageAttachment,
  isPdfAttachment
} from '../messaging/AttachmentViews';

export interface ListedDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** Private Storage object path; resolved to a short-lived signed URL via `resolveUrls`. */
  path?: string;
  /** Already-usable URL (legacy inline/external files). */
  directUrl?: string;
  /** Small caption under the file name, e.g. "CV / Primary document". */
  label: string;
}

interface Props {
  documents: ListedDocument[];
  resolveUrls: (documents: ListedDocument[]) => Promise<Record<string, string>>;
  compact?: boolean;
  emptyText?: string;
  /** Shown for documents that have neither a stored path nor a URL (e.g. records created before uploads existed). */
  unavailableText?: string;
}

type Row = ListedDocument & { url?: string };

const toAttachment = (doc: Row): MessageAttachment => ({
  id: doc.id,
  fileName: doc.fileName,
  fileType: doc.fileType,
  fileSize: doc.fileSize,
  path: doc.path,
  urlOrBase64: doc.url || ''
});

/** In-app PDF viewer. Desktop gets an inline frame; touch devices (where PDFs can't render inline) get open/download. */
const PdfPreviewModal: React.FC<{ doc: Row; onClose: () => void }> = ({ doc, onClose }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canEmbed = useMemo(
    () => typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches && (navigator as any).pdfViewerEnabled !== false,
    []
  );

  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(doc.url!);
        if (!res.ok) throw new Error(String(res.status));
        const blob = new Blob([await res.arrayBuffer()], { type: 'application/pdf' });
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      if (created) URL.revokeObjectURL(created);
    };
  }, [doc.url, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${doc.fileName}`} className="fixed inset-0 z-[70] bg-black/85 flex flex-col">
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
              try {
                await downloadAttachment(toAttachment(doc));
              } finally {
                setDownloading(false);
              }
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

const DownloadButton: React.FC<{ doc: Row; disabled: boolean }> = ({ doc, disabled }) => {
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

/**
 * Generic list of stored files with View + Download. Images open in a zoomable lightbox, PDFs in an in-app viewer;
 * Word/RTF/TXT files download under their real name. Used for application CVs and verification evidence.
 */
export const DocumentList: React.FC<Props> = ({
  documents,
  resolveUrls,
  compact,
  emptyText = 'No documents attached.',
  unavailableText = 'File not available'
}) => {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageDoc, setImageDoc] = useState<Row | null>(null);
  const [pdfDoc, setPdfDoc] = useState<Row | null>(null);

  // Stable key so a parent re-render with an equal list does not refetch signed URLs.
  const key = documents.map((d) => d.path || d.id).join('|');

  const load = useCallback(async () => {
    const stored = documents.filter((d) => d.path);
    if (stored.length === 0) return;
    setLoading(true);
    setFailed(false);
    try {
      setUrls(await resolveUrls(stored));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  if (documents.length === 0) return <p className="text-xs text-[#606C38]">{emptyText}</p>;

  const rows: Row[] = documents.map((d) => ({ ...d, url: d.path ? urls[d.path] : d.directUrl }));

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
        const neverStored = !doc.path && !doc.directUrl;
        return (
          <div key={doc.id} className="p-3 bg-white rounded-xl border border-[#E8E4D9] flex items-center gap-3 min-w-0">
            {image ? <ImageIcon className="w-5 h-5 text-[#4F772D] shrink-0" /> : <FileText className="w-5 h-5 text-[#4F772D] shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#283618] truncate">{doc.fileName}</p>
              <p className="text-[11px] text-[#606C38] truncate">
                {neverStored ? unavailableText : doc.label}
                {!neverStored && doc.fileSize > 0 && ` · ${formatFileSize(doc.fileSize)}`}
                {!ready && !neverStored && loading && ' · Loading…'}
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
