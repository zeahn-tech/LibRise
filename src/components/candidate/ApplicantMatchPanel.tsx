import React, { useCallback, useEffect, useState } from 'react';
import { Award, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { applicationService } from '../../services/applicationService';
import { candidateService } from '../../services/candidateService';
import { opportunityService } from '../../services/opportunityService';
import { candidateToMatchInput, opportunityToMatchInput } from '../../services/ai/aiMappers';
import type { Application } from '../../types';
import type { CandidateMatchInput } from '../../services/ai/aiTypes';
import { AiCandidateMatchModal } from './AiCandidateMatchModal';

/**
 * Employer tool: pick a REAL applicant to one of your vacancies and get an explainable, non-discriminatory
 * match analysis. Candidate data comes from the applicant's own profile (honouring their privacy settings);
 * nothing here is sample data.
 */
export const ApplicantMatchPanel: React.FC<{ onAnalysisClosed?: () => void }> = ({ onAnalysisClosed }) => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [target, setTarget] = useState<{ candidate: CandidateMatchInput['candidate']; opportunity: CandidateMatchInput['opportunity'] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await applicationService.listByOrganization();
    if (res.error) setError(res.error.message);
    else setApplications((res.data || []).filter((a) => a.stage !== 'withdrawn'));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const evaluate = async () => {
    const app = applications.find((a) => a.id === selectedId);
    if (!app) return;
    setPreparing(true);
    setError('');
    try {
      const userId = app.candidateUserId || app.applicantUserId;
      if (!userId) throw new Error('This application is not linked to a candidate profile.');
      const [profileRes, oppRes] = await Promise.all([candidateService.getPublicProfile(userId), opportunityService.getById(app.opportunityId)]);
      if (profileRes.error) throw new Error(profileRes.error.message);
      if (!profileRes.data) throw new Error('This applicant has not shared a profile you can analyse (their privacy settings hide it).');
      if (oppRes.error || !oppRes.data) throw new Error(oppRes.error?.message || 'The vacancy could not be loaded.');
      setTarget({
        candidate: candidateToMatchInput(profileRes.data, app.applicantName),
        opportunity: opportunityToMatchInput(oppRes.data)
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the analysis.');
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#606C38] leading-relaxed">
        Choose an applicant to one of your vacancies. The analysis compares skills, experience, county and education against the role. It is advisory only: people make every hiring decision.
      </p>

      {loading && <p className="text-xs text-stone-500 py-4 text-center">Loading your applicants…</p>}

      {!loading && error && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 text-red-800 text-xs flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={load} className="shrink-0 font-bold flex items-center gap-1"><RefreshCw className="w-3 h-3" />Retry</button>
        </div>
      )}

      {!loading && !error && applications.length === 0 && (
        <div className="p-5 rounded-2xl border border-dashed border-[#D9E3D5] text-center text-xs text-stone-500">
          <Award className="w-8 h-8 mx-auto text-[#A3B18A] mb-2" />
          No applications yet. When candidates apply to your vacancies they will appear here for analysis.
        </div>
      )}

      {!loading && applications.length > 0 && (
        <>
          <label className="block text-xs font-semibold text-[#283618]" htmlFor="applicant-select">Applicant</label>
          <select
            id="applicant-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-sm outline-none"
          >
            <option value="">Select an applicant…</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>{a.applicantName} — {a.opportunityTitle}</option>
            ))}
          </select>
          <button
            onClick={evaluate}
            disabled={!selectedId || preparing}
            className="w-full py-3 min-h-11 bg-[#4F772D] hover:bg-[#283618] disabled:opacity-50 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2"
          >
            {preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {preparing ? 'Preparing…' : 'Evaluate candidate fit'}
          </button>
        </>
      )}

      {target && (
        <AiCandidateMatchModal
          isOpen
          onClose={() => {
            setTarget(null);
            onAnalysisClosed?.();
          }}
          candidate={target.candidate}
          opportunity={target.opportunity}
        />
      )}
    </div>
  );
};
