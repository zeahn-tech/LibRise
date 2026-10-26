import React, { useEffect } from 'react';
import { ArrowLeft, ChevronRight, Cookie, FileText, ListTree, ShieldCheck, Undo2 } from 'lucide-react';
import { getLegalDocument, type LegalBlock, type LegalDocument } from '../../legal/documents';
import { LEGAL, LEGAL_NAV, legalPath, type LegalSlug } from '../../legal/legalConfig';
import { openCookieSettings } from '../../lib/consent';

interface Props {
  /** The part of the path after /legal/ (empty for the index). */
  slug: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
}

const NAV_ICON: Record<LegalSlug, React.ReactNode> = {
  privacy: <ShieldCheck className="w-4 h-4" />,
  terms: <FileText className="w-4 h-4" />,
  refunds: <Undo2 className="w-4 h-4" />,
  cookies: <Cookie className="w-4 h-4" />
};

/** Renders **bold** and [label](href) inside a string. */
export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={i++} className="font-semibold text-[#132A13]">{m[1]}</strong>);
    } else {
      const href = m[3];
      const external = /^https?:\/\//i.test(href);
      out.push(
        <a
          key={i++}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="text-[#4F772D] font-semibold underline underline-offset-2 hover:text-[#283618] break-words"
        >
          {m[2]}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const Block: React.FC<{ block: LegalBlock }> = ({ block }) => {
  switch (block.t) {
    case 'p':
      return <p className="text-sm leading-relaxed text-[#2D2D2D]">{renderInline(block.text)}</p>;
    case 'note':
      return (
        <p className="text-sm leading-relaxed text-[#283618] bg-[#ECF3E9] border border-[#D9E3D5] rounded-2xl px-4 py-3">
          {renderInline(block.text)}
        </p>
      );
    case 'ul':
      return (
        <ul className="space-y-2 text-sm leading-relaxed text-[#2D2D2D] list-disc pl-5 marker:text-[#4F772D]">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <>
          {/* Phones: one card per row, so nothing needs sideways scrolling */}
          <div className="sm:hidden space-y-3">
            {block.rows.map((row, ri) => (
              <div key={ri} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-2">
                <div className="text-sm font-bold text-[#132A13] break-words">{renderInline(row[0])}</div>
                {row.slice(1).map((cell, ci) => (
                  <div key={ci} className="text-xs leading-relaxed text-[#2D2D2D]">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-[#A3B18A] mb-0.5">{block.head[ci + 1]}</span>
                    {renderInline(cell)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="hidden sm:block overflow-x-auto rounded-2xl border border-[#E8E4D9] bg-white">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#F2F2EC] text-[#606C38]">
                <tr>
                  {block.head.map((h) => (
                    <th key={h} className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E4D9]">
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="align-top">
                    {row.map((cell, ci) => (
                      <td key={ci} className={`px-4 py-3 leading-relaxed ${ci === 0 ? 'font-semibold text-[#132A13]' : 'text-[#2D2D2D]'}`}>
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
  }
};

const DocumentView: React.FC<{ doc: LegalDocument }> = ({ doc }) => {
  const jump = (id: string) => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const others = LEGAL_NAV.filter((n) => n.slug !== doc.slug);

  return (
    <article>
      <h1 className="text-3xl sm:text-4xl font-serif font-bold text-[#132A13]">{doc.title}</h1>
      <p className="mt-2 text-sm text-[#606C38]">{doc.summary}</p>
      <p className="mt-1 text-xs text-[#A3B18A] font-semibold">Last updated {LEGAL.lastUpdated} · Version {LEGAL.documentVersion}</p>

      <details className="mt-5 rounded-2xl border border-[#E8E4D9] bg-white open:shadow-sm">
        <summary className="flex items-center gap-2 min-h-11 px-4 cursor-pointer text-sm font-bold text-[#283618] select-none">
          <ListTree className="w-4 h-4 text-[#4F772D]" /> On this page
        </summary>
        <ol className="px-4 pb-3 space-y-0.5">
          {doc.sections.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => jump(s.id)} className="w-full text-left min-h-11 flex items-center gap-2 text-sm text-[#4F772D] hover:text-[#283618] cursor-pointer">
                <span className="text-[#A3B18A] w-5 shrink-0">{i + 1}.</span> {s.heading}
              </button>
            </li>
          ))}
        </ol>
      </details>

      {doc.slug === 'cookies' && (
        <button
          type="button"
          onClick={openCookieSettings}
          className="mt-4 inline-flex items-center gap-2 min-h-11 px-5 rounded-xl bg-[#283618] text-white text-xs font-bold hover:bg-[#132A13] cursor-pointer"
        >
          <Cookie className="w-4 h-4" /> Open cookie settings
        </button>
      )}

      <div className="mt-8 space-y-9">
        {doc.sections.map((s, i) => (
          <section key={s.id} id={`sec-${s.id}`} className="scroll-mt-32 space-y-3">
            <h2 className="text-lg sm:text-xl font-serif font-bold text-[#132A13]">
              <span className="text-[#A3B18A] mr-2">{i + 1}.</span>
              {s.heading}
            </h2>
            {s.blocks.map((b, bi) => (
              <Block key={bi} block={b} />
            ))}
          </section>
        ))}
      </div>

      <nav aria-label="Other legal documents" className="mt-12 pt-6 border-t border-[#E8E4D9] grid sm:grid-cols-3 gap-3">
        {others.map((n) => (
          <a key={n.slug} href={`#${legalPath(n.slug)}`} className="flex items-center justify-between gap-2 min-h-11 px-4 rounded-2xl border border-[#E8E4D9] bg-white text-sm font-semibold text-[#283618] hover:border-[#4F772D]">
            <span className="flex items-center gap-2">{NAV_ICON[n.slug]} {n.label}</span>
            <ChevronRight className="w-4 h-4 text-[#A3B18A]" />
          </a>
        ))}
      </nav>
    </article>
  );
};

/** Standalone page for the four legal documents. Reachable before sign-in (landing screen, sign-up form, footer). */
export const LegalPage: React.FC<Props> = ({ slug, onNavigate, onBack }) => {
  const doc = slug ? getLegalDocument(slug) : null;

  useEffect(() => {
    window.scrollTo(0, 0);
    const prev = document.title;
    document.title = `${doc ? doc.title : 'Legal'} · ${LEGAL.productName}`;
    return () => {
      document.title = prev;
    };
  }, [slug, doc]);

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#2D2D2D] font-sans pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#E8E4D9] pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto px-4 flex items-center gap-3 h-14">
          <button type="button" onClick={onBack} aria-label="Go back" className="min-w-11 min-h-11 -ml-2 flex items-center justify-center rounded-xl text-[#283618] hover:bg-[#ECF3E9] cursor-pointer">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button type="button" onClick={() => onNavigate('/')} className="font-serif font-bold text-lg text-[#132A13] cursor-pointer">
            Lib<span className="text-[#4F772D]">Rise</span>
          </button>
          <span className="text-xs font-bold uppercase tracking-wider text-[#A3B18A] ml-auto">Legal</span>
        </div>
        <div className="max-w-3xl mx-auto px-4 pb-2 flex gap-2 overflow-x-auto">
          {LEGAL_NAV.map((n) => (
            <a
              key={n.slug}
              href={`#${legalPath(n.slug)}`}
              aria-current={n.slug === slug ? 'page' : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full text-xs font-bold border ${
                n.slug === slug ? 'bg-[#283618] text-white border-[#283618]' : 'bg-white text-[#606C38] border-[#E8E4D9] hover:border-[#4F772D]'
              }`}
            >
              {NAV_ICON[n.slug]} {n.short}
            </a>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-20">
        {doc ? (
          <DocumentView doc={doc} />
        ) : (
          <div>
            <h1 className="text-3xl font-serif font-bold text-[#132A13]">Legal</h1>
            <p className="mt-2 text-sm text-[#606C38]">The rules and policies that apply when you use {LEGAL.productName}.</p>
            <div className="mt-6 grid gap-3">
              {LEGAL_NAV.map((n) => {
                const d = getLegalDocument(n.slug)!;
                return (
                  <a key={n.slug} href={`#${legalPath(n.slug)}`} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 hover:border-[#4F772D]">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#132A13]">{NAV_ICON[n.slug]} {n.label}</div>
                    <p className="mt-1 text-xs text-[#606C38]">{d.summary}</p>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
