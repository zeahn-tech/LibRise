import React, { useState } from 'react';
import { Sparkles, X, ShieldAlert, Lock, Loader2, Copy, Check, AlertTriangle, ShieldCheck } from 'lucide-react';
import { aiService } from '../services/ai/aiService';
import { JobAssistantResult, ScamCheckResult } from '../services/ai/aiTypes';
import { useEntitlements } from '../hooks/useEntitlements';
import { ApplicantMatchPanel } from './candidate/ApplicantMatchPanel';

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mode = 'copilot' | 'anti_scam' | 'match';

const OPPORTUNITY_TYPES = ['Job', 'Tender', 'Internship', 'Volunteer', 'Consultancy'];

const RISK_STYLES: Record<ScamCheckResult['riskLevel'], string> = {
  low: 'bg-green-50 border-green-200 text-green-900',
  medium: 'bg-amber-50 border-amber-200 text-amber-900',
  high: 'bg-red-50 border-red-200 text-red-900'
};

function draftToText(d: JobAssistantResult): string {
  return [
    d.refinedTitle,
    '',
    d.executiveSummary,
    '',
    'Responsibilities:',
    ...(d.structuredResponsibilities || []).map((r) => `• ${r}`),
    '',
    'Requirements:',
    ...(d.keyRequirements || []).map((r) => `• ${r}`),
    '',
    'Screening questions:',
    ...(d.suggestedScreeningQuestions || []).map((q, i) => `${i + 1}. ${q.question}`)
  ].join('\n');
}

/**
 * Employer AI Copilot. Every tab calls the real AI service (Gemini on the server, or the clearly-labelled
 * heuristic engine when the server is unavailable). No canned output.
 */
export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({ isOpen, onClose }) => {
  const { entitlements, loading: loadingAccess } = useEntitlements();
  const hasAccess = entitlements.canUseAI;

  const [mode, setMode] = useState<Mode>('copilot');

  // Job description drafter
  const [title, setTitle] = useState('');
  const [county, setCounty] = useState('');
  const [oppType, setOppType] = useState('Job');
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<JobAssistantResult | null>(null);
  const [draftError, setDraftError] = useState('');
  const [copied, setCopied] = useState(false);

  // Scam shield
  const [scanText, setScanText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScamCheckResult | null>(null);
  const [scanError, setScanError] = useState('');

  if (!isOpen) return null;

  const handleDraft = async () => {
    if (!title.trim()) {
      setDraftError('Enter the vacancy title first.');
      return;
    }
    setDrafting(true);
    setDraft(null);
    setDraftError('');
    try {
      setDraft(
        await aiService.assistJobDescription({
          title: title.trim(),
          county: county.trim() || undefined,
          opportunityType: oppType,
          rawNotesOrDraft: notes.trim()
        })
      );
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'The draft could not be generated. Please try again.');
    } finally {
      setDrafting(false);
    }
  };

  const handleCopy = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draftToText(draft));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setDraftError('Copy is not available in this browser. Select the text and copy it manually.');
    }
  };

  const handleScan = async () => {
    if (scanText.trim().length < 20) {
      setScanError('Paste the full vacancy or listing text (at least a couple of sentences).');
      return;
    }
    setScanning(true);
    setScan(null);
    setScanError('');
    try {
      setScan(await aiService.scanForScams({ text: scanText.trim() }));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'The scan could not be completed. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const tabClass = (m: Mode) =>
    `px-3.5 py-2 min-h-10 rounded-xl font-bold whitespace-nowrap transition-all ${mode === m ? 'bg-[#283618] text-white' : 'text-[#606C38] hover:text-[#283618]'}`;
  const inputClass = 'w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] outline-none text-sm focus:border-[#A3B18A]';

  return (
    <div className="fixed inset-0 bg-[#132A13]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="LibRise AI Copilot">
      <div className="bg-white w-full max-w-2xl rounded-[32px] sm:rounded-[40px] border border-[#E8E4D9] shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        <div className="p-6 bg-[#ECF3E9] border-b border-[#D9E3D5] relative flex-none">
          <button onClick={onClose} aria-label="Close" className="absolute top-6 right-6 w-11 h-11 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-[#283618] border border-[#D9E3D5]">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#BC6C25] mb-1">
            <Sparkles className="w-4 h-4" />
            <span>AI assistant for employers</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#132A13] pr-12">LibRise AI Copilot</h2>
          <p className="text-xs text-[#606C38] mt-1">Draft vacancies, screen text for fraud, and analyse real applicants.</p>
        </div>

        <div className="p-4 bg-[#F9F8F4] border-b border-[#E8E4D9] flex items-center gap-2 overflow-x-auto text-xs">
          <button onClick={() => setMode('copilot')} className={tabClass('copilot')}>Job Description Drafter</button>
          <button onClick={() => setMode('anti_scam')} className={tabClass('anti_scam')}>Scam & Fraud Shield</button>
          <button onClick={() => setMode('match')} className={tabClass('match')}>Applicant Match</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs sm:text-sm relative">
          {loadingAccess && <p className="text-center text-stone-500 py-8">Checking your plan…</p>}

          {!loadingAccess && !hasAccess && (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 bg-[#FEFAE0] text-[#BC6C25] rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold font-display tracking-tight text-[#132A13] mb-2">AI Copilot is a Professional-plan feature</h3>
              <p className="text-sm text-stone-500 mb-6">Your current plan does not include the AI workspace. Upgrade to unlock job drafting, fraud screening and applicant analysis.</p>
              <button onClick={onClose} className="px-6 py-2.5 bg-[#283618] hover:bg-[#132A13] text-white rounded-xl font-bold transition-all">Close & view plans</button>
            </div>
          )}

          {!loadingAccess && hasAccess && mode === 'copilot' && (
            <div className="space-y-3">
              <div>
                <label htmlFor="ai-title" className="block text-xs font-semibold text-[#283618] mb-1">Vacancy title / role</label>
                <input id="ai-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g., Agricultural Extension Supervisor" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ai-county" className="block text-xs font-semibold text-[#283618] mb-1">County</label>
                  <input id="ai-county" type="text" value={county} onChange={(e) => setCounty(e.target.value)} maxLength={60} className={inputClass} placeholder="e.g., Nimba" />
                </div>
                <div>
                  <label htmlFor="ai-type" className="block text-xs font-semibold text-[#283618] mb-1">Type</label>
                  <select id="ai-type" value={oppType} onChange={(e) => setOppType(e.target.value)} className={inputClass}>
                    {OPPORTUNITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="ai-notes" className="block text-xs font-semibold text-[#283618] mb-1">Your notes or rough draft (optional)</label>
                <textarea id="ai-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} className={inputClass} placeholder="Key duties, must-have skills, salary range, anything the AI should include" />
              </div>
              <button onClick={handleDraft} disabled={drafting} className="w-full py-3 min-h-11 bg-[#283618] hover:bg-[#132A13] disabled:opacity-60 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2">
                {drafting ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Drafting…</span></> : <><Sparkles className="w-4 h-4 text-[#A3B18A]" /><span>Generate draft</span></>}
              </button>
              {draftError && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-800 text-xs">{draftError}</p>}
              {draft && (
                <div className="p-4 bg-[#F9F8F4] rounded-2xl border border-[#D9E3D5] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-bold text-[#132A13] text-sm">{draft.refinedTitle}</h4>
                    <button onClick={handleCopy} className="shrink-0 px-3 py-1.5 min-h-9 rounded-lg bg-white border border-[#D9E3D5] text-[11px] font-bold text-[#283618] flex items-center gap-1.5">
                      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="text-xs leading-relaxed text-[#2D2D2D]">{draft.executiveSummary}</p>
                  {draft.structuredResponsibilities?.length > 0 && (
                    <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#606C38] mb-1">Responsibilities</p><ul className="list-disc pl-5 space-y-1 text-xs">{draft.structuredResponsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                  )}
                  {draft.keyRequirements?.length > 0 && (
                    <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#606C38] mb-1">Requirements</p><ul className="list-disc pl-5 space-y-1 text-xs">{draft.keyRequirements.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                  )}
                  {draft.suggestedScreeningQuestions?.length > 0 && (
                    <div><p className="text-[11px] font-bold uppercase tracking-wider text-[#606C38] mb-1">Screening questions</p><ol className="list-decimal pl-5 space-y-1 text-xs">{draft.suggestedScreeningQuestions.map((q, i) => <li key={i}>{q.question}</li>)}</ol></div>
                  )}
                  <p className="text-[10px] text-stone-500">Review and edit before publishing.</p>
                </div>
              )}
            </div>
          )}

          {!loadingAccess && hasAccess && mode === 'anti_scam' && (
            <div className="space-y-3">
              <p className="text-xs text-[#606C38] leading-relaxed">
                Paste a vacancy, tender or business teaser. The scan looks for advance-fee requests, mobile-money or wire demands, vague employers and off-platform-only contact.
              </p>
              <label htmlFor="ai-scan" className="sr-only">Text to scan</label>
              <textarea id="ai-scan" rows={6} value={scanText} onChange={(e) => setScanText(e.target.value)} maxLength={20000} className={inputClass} placeholder="Paste the full text here…" />
              <button onClick={handleScan} disabled={scanning} className="w-full py-3 min-h-11 bg-[#BC6C25] hover:bg-[#a65d1d] disabled:opacity-60 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2">
                {scanning ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Scanning…</span></> : <span>Scan for fraud</span>}
              </button>
              {scanError && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-800 text-xs">{scanError}</p>}
              {scan && (
                <div className={`p-4 rounded-2xl border space-y-3 ${RISK_STYLES[scan.riskLevel]}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      {scan.riskLevel === 'low' ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      <span className="capitalize">{scan.riskLevel} risk</span>
                    </div>
                    <span className="text-xs font-bold tabular-nums">Risk score {scan.riskScore}/100</span>
                  </div>
                  {scan.findings.length > 0 ? (
                    <ul className="space-y-2">
                      {scan.findings.map((f, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-bold">{f.indicator}</span>
                          <span className="uppercase text-[10px] font-bold ml-2 opacity-70">{f.severity}</span>
                          {f.quote && <p className="italic opacity-80">“{f.quote}”</p>}
                          <p>{f.explanation}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs">No red flags were found in this text.</p>
                  )}
                  <p className="text-xs font-semibold">{scan.recommendation}</p>
                  <p className="text-[10px] opacity-70">
                    {scan.providerUsed}{scan.isHeuristic ? ' · keyword rules only, not an AI review' : ''}. This screens wording; it cannot confirm that an employer is real.
                  </p>
                </div>
              )}
            </div>
          )}

          {!loadingAccess && hasAccess && mode === 'match' && <ApplicantMatchPanel />}

          <div className="p-3.5 bg-[#FEFAE0] rounded-2xl border border-[#E8E4D9] flex items-start gap-2.5 text-[11px] text-[#606C38]">
            <ShieldAlert className="w-4 h-4 text-[#BC6C25] shrink-0 mt-0.5" />
            <span><strong>Ethical AI directive:</strong> AI is an assistant only. Final employment, tender and acquisition decisions are made by authorised people.</span>
          </div>
        </div>

        <div className="p-4 bg-white border-t border-[#E8E4D9] flex justify-end">
          <button onClick={onClose} className="px-5 py-2 min-h-10 bg-[#F2F2EC] hover:bg-[#E8E4D9] text-[#283618] rounded-xl text-xs font-bold">Done</button>
        </div>
      </div>
    </div>
  );
};
