import React from 'react';

/**
 * The LibRise brand mark + wordmark. Used by BOTH the landing header and the
 * main app header so the name, logo and styling are always identical.
 * Renders content only; wrap it in a button/link where a click action is needed.
 */
export const BrandLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`flex items-center gap-2 sm:gap-2.5 text-left shrink-0 font-sans ${className}`}>
    <span className="w-9 h-9 sm:w-10 sm:h-10 bg-[#283618] rounded-xl flex items-center justify-center shadow-xs transition-transform group-hover:scale-105 shrink-0">
      <span className="w-5 h-5 border-2 border-white rounded-full flex items-center justify-center">
        <span className="w-1.5 h-1.5 bg-white rounded-full" />
      </span>
    </span>
    <span className="block">
      <span className="block text-lg sm:text-xl font-bold tracking-tight text-[#132A13] leading-none">
        Lib<span className="text-[#BC6C25]">Rise</span>
      </span>
      <span className="block text-[10px] tracking-widest uppercase font-bold text-[#606C38]">LIBERIA</span>
    </span>
  </span>
);
