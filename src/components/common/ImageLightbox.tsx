import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageLightboxProps {
  photos: string[];
  startIndex?: number;
  alt: string;
  onClose: () => void;
}

/**
 * Full-screen photo viewer. Tap/click the dark backdrop, the X, or press Esc to
 * close; use the arrows (or keyboard arrows) to move between photos.
 * Rendered in a portal so it always sits above any modal it is opened from.
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ photos, startIndex = 0, alt, onClose }) => {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), photos.length - 1));
  const many = photos.length > 1;
  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (many && e.key === 'ArrowLeft') go(-1);
      else if (many && e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, photos.length, onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} photos`}
      className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-3 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo viewer"
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 sm:right-6 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      <img
        src={photos[index]}
        alt={`${alt} - photo ${index + 1} of ${photos.length}`}
        onClick={(e) => e.stopPropagation()}
        referrerPolicy="no-referrer"
        className="max-w-full max-h-full object-contain rounded-lg select-none"
      />

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs font-semibold">
            {index + 1} / {photos.length}
          </div>
        </>
      )}
    </div>,
    document.body
  );
};
