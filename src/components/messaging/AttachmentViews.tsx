import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, X, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';
import { MessageAttachment } from '../../types';

export const isImageAttachment = (att: Pick<MessageAttachment, 'fileType' | 'fileName'>): boolean =>
  att.fileType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(att.fileName || '');

export const isPdfAttachment = (att: Pick<MessageAttachment, 'fileType' | 'fileName'>): boolean =>
  att.fileType === 'application/pdf' || /\.pdf$/i.test(att.fileName || '');

export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Saves the file to the user's device with its original name and bytes intact. A plain <a download> is
 * ignored by browsers for cross-origin (signed Storage) URLs, so the file is fetched as a Blob and saved
 * from a same-origin object URL. Falls back to opening the URL if the fetch is blocked.
 */
export async function downloadAttachment(att: Pick<MessageAttachment, 'urlOrBase64' | 'fileName'>): Promise<void> {
  if (!att.urlOrBase64) throw new Error('This file is not available right now. Please refresh and try again.');
  try {
    const res = await fetch(att.urlOrBase64);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = att.fileName || 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(att.urlOrBase64, '_blank', 'noopener,noreferrer');
  }
}

/** Full-screen viewer for images with zoom (buttons, wheel, double-click), Esc/backdrop to close, and download. */
export const AttachmentLightbox: React.FC<{ attachment: MessageAttachment; onClose: () => void }> = ({ attachment, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const clamp = (z: number) => Math.min(4, Math.max(1, Math.round(z * 100) / 100));
  const zoomIn = useCallback(() => setZoom((z) => clamp(z + 0.5)), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp(z - 0.5)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, zoomIn, zoomOut]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadAttachment(attachment);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${attachment.fileName}`}
      className="fixed inset-0 z-[60] bg-black/85 flex flex-col"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{attachment.fileName}</p>
          <p className="text-[11px] text-white/60">{formatFileSize(attachment.fileSize)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={zoomOut} disabled={zoom <= 1} aria-label="Zoom out" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10 disabled:opacity-40">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} disabled={zoom >= 4} aria-label="Zoom in" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10 disabled:opacity-40">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button type="button" onClick={handleDownload} disabled={downloading} aria-label="Download" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10">
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          </button>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preview" className="min-w-11 min-h-11 flex items-center justify-center rounded-xl hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setZoom((z) => clamp(z + (e.deltaY < 0 ? 0.25 : -0.25)));
          }
        }}
      >
        <div className="min-h-full min-w-full flex items-center justify-center p-4">
          <img
            src={attachment.urlOrBase64}
            alt={attachment.fileName}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
            style={{ width: zoom === 1 ? undefined : `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? 'calc(100vh - 110px)' : 'none' }}
            className={`object-contain rounded-lg select-none ${zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
          />
        </div>
      </div>
    </div>
  );
};

/** One attachment inside a chat bubble: image thumbnail (click to expand) or a file card with open/download. */
export const AttachmentTile: React.FC<{
  attachment: MessageAttachment;
  isMine: boolean;
  onPreview: (att: MessageAttachment) => void;
}> = ({ attachment, isMine, onPreview }) => {
  const [downloading, setDownloading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const unavailable = !attachment.urlOrBase64;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloading(true);
    try {
      await downloadAttachment(attachment);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const cardTone = isMine
    ? 'bg-white/10 hover:bg-white/20 text-white'
    : 'bg-[#F9F8F6] hover:bg-[#ECF3E9] text-[#283618] border border-[#E8E4D9]';

  if (isImageAttachment(attachment) && !unavailable && !imageFailed) {
    return (
      <div className="relative group w-full max-w-[260px]">
        <button
          type="button"
          onClick={() => onPreview(attachment)}
          aria-label={`Open preview of ${attachment.fileName}`}
          className="block w-full overflow-hidden rounded-xl border border-black/10 bg-black/5 cursor-zoom-in"
        >
          <img
            src={attachment.urlOrBase64}
            alt={attachment.fileName}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="w-full max-h-64 object-cover"
          />
        </button>
        <button
          type="button"
          onClick={handleDownload}
          aria-label={`Download ${attachment.fileName}`}
          className="absolute top-2 right-2 min-w-9 min-h-9 flex items-center justify-center rounded-full bg-black/60 text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        </button>
        <p className="mt-1 text-[10px] opacity-70 truncate">{attachment.fileName} · {formatFileSize(attachment.fileSize)}</p>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 p-2 rounded-xl text-[11px] font-semibold transition-colors ${cardTone}`}>
      {isImageAttachment(attachment) ? <ImageIcon className="w-4 h-4 shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="truncate">{attachment.fileName}</p>
        <p className="text-[9px] opacity-70 font-normal">{unavailable || imageFailed ? 'Preview unavailable' : formatFileSize(attachment.fileSize)}</p>
      </div>
      {!unavailable && isPdfAttachment(attachment) && (
        <a
          href={attachment.urlOrBase64}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${attachment.fileName} in a new tab`}
          className="min-w-9 min-h-9 flex items-center justify-center rounded-lg hover:bg-black/10"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
      <button
        type="button"
        onClick={handleDownload}
        disabled={unavailable || downloading}
        aria-label={`Download ${attachment.fileName}`}
        className="min-w-9 min-h-9 flex items-center justify-center rounded-lg hover:bg-black/10 disabled:opacity-40"
      >
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      </button>
    </div>
  );
};
