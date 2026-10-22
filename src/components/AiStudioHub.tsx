import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Brain,
  ShieldCheck,
  FileText,
  UserCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Terminal,
  Activity,
  Award,
  Lock,
  Building2
} from 'lucide-react';
import { aiService, AIAuditLogEntry } from '../services/ai/aiService';
import { ApplicantMatchPanel } from './candidate/ApplicantMatchPanel';
import { AiCvParserModal } from './candidate/AiCvParserModal';
import { AiJobRecommendationsWidget } from './candidate/AiJobRecommendationsWidget';
import { opportunityService } from '../services/opportunityService';
import { candidateService } from '../services/candidateService';
import { candidateToRecommendationInput, mergeParsedCvIntoProfile } from '../services/ai/aiMappers';
import type { CandidateProfile } from '../types';
import { ParsedCVResult } from '../services/ai/aiTypes';
import { useAuth } from '../context/AuthContext';
import { useEntitlements } from '../hooks/useEntitlements';
import { AiStudioTool, canUseAiStudioTool } from '../core/auth/featureAccess';
import { UpgradePrompt } from './common/UpgradePrompt';

interface AiStudioHubProps {
  /** Present only when the viewer may open billing (org owner/admin). */
  onOpenBilling?: () => void;
}

export const AiStudioHub: React.FC<AiStudioHubProps> = ({ onOpenBilling }) => {
  const { authContext } = useAuth();
  const { entitlements } = useEntitlements();
  // Each tool is shown only to the audience it was built for (see featureAccess.ts).
  const allowed = (tool: AiStudioTool) => canUseAiStudioTool(authContext, tool);
  const [activeTab, setActiveTab] = useState<AiStudioTool>('overview');
  const [previewOpportunities, setPreviewOpportunities] = useState<import('../types').Opportunity[]>([]);

  useEffect(() => {
    if (activeTab !== 'recommendations') return;
    opportunityService.list().then((res) => {
      if (res.data) setPreviewOpportunities(res.data);
    });
    setProfileState('loading');
    candidateService.getMyProfile().then((res) => {
      if (res.data) {
        setMyProfile(res.data);
        setProfileState('ready');
      } else {
        setProfileState('error');
      }
    });
  }, [activeTab]);
  const [auditLogs, setAuditLogs] = useState<AIAuditLogEntry[]>([]);
  const [activeProviderName, setActiveProviderName] = useState<string>('Detecting provider...');
  const [loadingProvider, setLoadingProvider] = useState(true);

  // Modal States
  const [isCvParserModalOpen, setIsCvParserModalOpen] = useState(false);
  const [parsedCV, setParsedCV] = useState<ParsedCVResult | null>(null);

  // Job Assistant State
  const [jobTitle, setJobTitle] = useState('');
  const [county, setCounty] = useState('');
  const [oppType, setOppType] = useState('Job');
  const [jobNotes, setJobNotes] = useState('');
  const [draftResult, setDraftResult] = useState<any | null>(null);
  const [draftError, setDraftError] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);

  // The signed-in candidate's real profile powers recommendations and CV saving.
  const [myProfile, setMyProfile] = useState<CandidateProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [cvSaveState, setCvSaveState] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ status: 'idle' });

  useEffect(() => {
    checkProviderStatus();
    refreshAuditLogs();
  }, []);

  const checkProviderStatus = async () => {
    setLoadingProvider(true);
    const provider = await aiService.getActiveProvider();
    setActiveProviderName(provider.name);
    setLoadingProvider(false);
  };

  const refreshAuditLogs = () => {
    setAuditLogs(aiService.getAuditLogs());
  };

  const handleRunJobAssistant = async () => {
    if (!jobTitle.trim()) {
      setDraftError('Enter the vacancy title first.');
      return;
    }
    setIsDrafting(true);
    setDraftResult(null);
    setDraftError('');
    try {
      const res = await aiService.assistJobDescription({
        title: jobTitle.trim(),
        county: county.trim() || undefined,
        opportunityType: oppType,
        rawNotesOrDraft: jobNotes.trim()
      });
      setDraftResult(res);
      refreshAuditLogs();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'The draft could not be generated. Please try again.');
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSaveCvToProfile = async () => {
    if (!parsedCV) return;
    setCvSaveState({ status: 'saving' });
    try {
      const current = myProfile ?? (await candidateService.getMyProfile()).data;
      if (!current) throw new Error('Your profile could not be loaded. Please try again.');
      const update = mergeParsedCvIntoProfile(current, parsedCV);
      if (Object.keys(update).length === 0) {
        setCvSaveState({ status: 'saved', message: 'Your profile already contains this information, so nothing was changed.' });
        return;
      }
      const res = await candidateService.saveMyProfile(update);
      if (res.error || !res.data) throw new Error(res.error?.message || 'Saving failed.');
      setMyProfile(res.data);
      setCvSaveState({ status: 'saved', message: 'Saved to your profile. Existing text, work history and education were not overwritten.' });
    } catch (err) {
      setCvSaveState({ status: 'error', message: err instanceof Error ? err.message : 'Saving failed. Please try again.' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="p-6 sm:p-8 bg-gradient-to-br from-[#132A13] to-[#283618] rounded-[32px] text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Brain className="w-64 h-64 text-white" />
        </div>

        <div className="relative z-10 space-y-3 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-bold text-[#DDA15E] border border-white/20">
            <Sparkles className="w-3.5 h-3.5 text-[#DDA15E]" />
            <span>AI-Ready Intelligence Layer Architecture</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight">
            LibRise AI Engine & Governance
          </h1>

          <p className="text-xs sm:text-sm text-[#A3B18A] leading-relaxed">
            Assistive intelligence layer supporting job recommendations, candidate-opportunity matching, CV parsing, job drafting assistance, and semantic search — with strict ethical guardrails and non-discrimination compliance.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-black/20 rounded-xl border border-white/10">
              <Activity className="w-4 h-4 text-[#DDA15E]" />
              <span className="font-semibold text-white/90">Active Provider:</span>
              <span className="font-bold text-[#DDA15E]">
                {loadingProvider ? 'Checking status...' : activeProviderName}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3.5 py-1.5 bg-black/20 rounded-xl border border-white/10">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-emerald-300">Sanitization Guardrails Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Controls */}
      <div className="bg-white p-2 rounded-2xl border border-[#E8E4D9] flex items-center gap-1 overflow-x-auto text-xs font-bold">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'overview' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          Intelligence Overview
        </button>
        {allowed('recommendations') && (
        <button
          onClick={() => setActiveTab('recommendations')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'recommendations' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          1. Job Recommendations
        </button>
        )}
        {allowed('match') && (
        <button
          onClick={() => setActiveTab('match')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'match' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          2. Candidate Match Rationale
        </button>
        )}
        {allowed('cv_parser') && (
        <button
          onClick={() => setActiveTab('cv_parser')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'cv_parser' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          3. CV / Resume Parser
        </button>
        )}
        {allowed('job_drafter') && (
        <button
          onClick={() => setActiveTab('job_drafter')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'job_drafter' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          4. Job Drafter Assistant
        </button>
        )}
        {allowed('audit_logs') && (
        <button
          onClick={() => setActiveTab('audit_logs')}
          className={`px-4 py-2.5 rounded-xl transition-all ${
            activeTab === 'audit_logs' ? 'bg-[#283618] text-white shadow-sm' : 'text-[#606C38] hover:text-[#283618]'
          }`}
        >
          Audit Logs ({auditLogs.length})
        </button>
        )}
      </div>

      {/* TAB CONTENT */}

      {/* 1. Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 bg-white rounded-3xl border border-[#E8E4D9] space-y-2">
              <div className="w-10 h-10 bg-[#ECF3E9] text-[#283618] rounded-2xl flex items-center justify-center font-bold">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#132A13]">Server-Side Gemini 3.8 Flash</h3>
              <p className="text-xs text-[#606C38] leading-relaxed">
                All AI calls route through backend Express endpoints (`/api/ai/*`) using `@google/genai` SDK with strict JSON output schemas.
              </p>
            </div>

            <div className="p-5 bg-white rounded-3xl border border-[#E8E4D9] space-y-2">
              <div className="w-10 h-10 bg-[#FEFAE0] text-[#BC6C25] rounded-2xl flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#132A13]">Demographic Sanitization</h3>
              <p className="text-xs text-[#606C38] leading-relaxed">
                Candidate profiles are sanitized prior to AI dispatch. Gender, age, ethnicity, tribe, and marital status are stripped from match logic.
              </p>
            </div>

            <div className="p-5 bg-white rounded-3xl border border-[#E8E4D9] space-y-2">
              <div className="w-10 h-10 bg-[#ECF3E9] text-[#4F772D] rounded-2xl flex items-center justify-center font-bold">
                <RefreshCw className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#132A13]">Seamless Fallback Cascade</h3>
              <p className="text-xs text-[#606C38] leading-relaxed">
                If Gemini API is offline or unconfigured, the system cascades to the deterministic Heuristic AI Engine with zero interruption.
              </p>
            </div>
          </div>

          <div className="p-6 bg-[#F9F8F4] rounded-3xl border border-[#E8E4D9] space-y-4">
            <h3 className="text-base font-serif font-bold text-[#132A13]">
              The 5 Primary AI Intelligence Modules
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-4 bg-white rounded-2xl border border-[#E8E4D9] space-y-1">
                <h4 className="font-bold text-[#283618] flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-[#BC6C25]" />
                  1. Personalized Job Recommendations
                </h4>
                <p className="text-[#606C38]">
                  Computes custom job opportunity recommendations for candidate profiles based on skill overlap and county preferences.
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-[#E8E4D9] space-y-1">
                <h4 className="font-bold text-[#283618] flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-[#4F772D]" />
                  2. Candidate-Job Matching Rationale
                </h4>
                <p className="text-[#606C38]">
                  Provides explainable breakdown across 4 non-sensitive categories (Skill Overlap, Experience Depth, County Alignment, Credentials).
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-[#E8E4D9] space-y-1">
                <h4 className="font-bold text-[#283618] flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-[#DDA15E]" />
                  3. CV / Resume Auto-Parser
                </h4>
                <p className="text-[#606C38]">
                  Extracts structured skills, work history, education, and county location from raw resume text to populate candidate profiles.
                </p>
              </div>

              <div className="p-4 bg-white rounded-2xl border border-[#E8E4D9] space-y-1">
                <h4 className="font-bold text-[#283618] flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-[#283618]" />
                  4. Job Description & Screening Drafter
                </h4>
                <p className="text-[#606C38]">
                  Assists employers in generating structured job descriptions, key responsibilities, and tailored candidate screening questions.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Job recommendations for the signed-in candidate */}
      {activeTab === 'recommendations' && allowed('recommendations') && (
        <div className="space-y-4">
          <div className="p-4 bg-[#F9F8F4] rounded-2xl border border-[#E8E4D9]">
            <h3 className="text-sm font-bold text-[#132A13]">Recommended opportunities for you</h3>
            <p className="text-xs text-[#606C38]">Ranked from your own profile skills, experience and county against live opportunities.</p>
          </div>

          {profileState === 'loading' && <p className="text-xs text-stone-500 text-center py-6">Loading your profile…</p>}
          {profileState === 'error' && (
            <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-xs">Your profile could not be loaded, so recommendations are unavailable. Please refresh and try again.</div>
          )}
          {profileState === 'ready' && myProfile && candidateToRecommendationInput(myProfile).skills.length === 0 && (
            <div className="p-5 rounded-2xl border border-dashed border-[#D9E3D5] text-center text-xs text-[#606C38]">
              Add your skills to your candidate profile (or use the CV Parser tab) and recommendations will appear here.
            </div>
          )}
          {profileState === 'ready' && myProfile && candidateToRecommendationInput(myProfile).skills.length > 0 && (
            <AiJobRecommendationsWidget candidateProfile={candidateToRecommendationInput(myProfile)} opportunities={previewOpportunities} />
          )}
        </div>
      )}

      {/* 3. Candidate Match Modal Demo */}
      {activeTab === 'match' && allowed('match') && !entitlements.canUseAI && (
        <UpgradePrompt
          title="AI-powered candidate matching"
          description="Explainable match analysis between candidates and your vacancies."
          planName="the Professional plan"
          onUpgrade={onOpenBilling}
        />
      )}
      {activeTab === 'match' && allowed('match') && entitlements.canUseAI && (
        <div className="p-6 bg-white rounded-3xl border border-[#E8E4D9] space-y-3">
          <div className="flex items-center gap-2">
            <Award className="w-6 h-6 text-[#BC6C25]" />
            <h3 className="text-base font-serif font-bold text-[#132A13]">Candidate alignment analysis</h3>
          </div>
          <ApplicantMatchPanel onAnalysisClosed={refreshAuditLogs} />
        </div>
      )}

      {/* 4. CV Parser Demo */}
      {activeTab === 'cv_parser' && allowed('cv_parser') && (
        <div className="p-8 bg-white rounded-3xl border border-[#E8E4D9] text-center space-y-4">
          <FileText className="w-12 h-12 text-[#4F772D] mx-auto" />
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-lg font-serif font-bold text-[#132A13]">
              AI Resume / CV Extractor
            </h3>
            <p className="text-xs text-[#606C38]">
              Paste or upload raw candidate CV text to auto-populate profile fields and extracted skills.
            </p>
          </div>

          <button
            onClick={() => setIsCvParserModalOpen(true)}
            className="px-6 py-3 bg-[#4F772D] hover:bg-[#283618] text-white font-bold rounded-2xl text-xs shadow-md transition-all flex items-center gap-2 mx-auto"
          >
            <Sparkles className="w-4 h-4 text-emerald-200" />
            <span>Open CV Parser Modal</span>
          </button>

          <AiCvParserModal
            isOpen={isCvParserModalOpen}
            onClose={() => {
              setIsCvParserModalOpen(false);
              refreshAuditLogs();
            }}
            onApplyParsedData={(data) => {
              setParsedCV(data);
              setCvSaveState({ status: 'idle' });
            }}
          />

          {parsedCV && (
            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-left space-y-2 max-w-xl mx-auto text-xs mt-4">
              <span className="font-bold text-emerald-950">Extracted from your CV (not saved yet):</span>
              {parsedCV.candidateName && <p><strong>Name:</strong> {parsedCV.candidateName}</p>}
              {parsedCV.county && <p><strong>Location:</strong> {parsedCV.county} County</p>}
              <p><strong>Skills:</strong> {(parsedCV.extractedSkills || []).join(', ') || 'None found'}</p>
              <button
                onClick={handleSaveCvToProfile}
                disabled={cvSaveState.status === 'saving' || cvSaveState.status === 'saved'}
                className="mt-1 px-5 py-2.5 min-h-10 bg-[#4F772D] hover:bg-[#283618] disabled:opacity-60 text-white font-bold rounded-xl text-xs"
              >
                {cvSaveState.status === 'saving' ? 'Saving…' : cvSaveState.status === 'saved' ? 'Saved' : 'Save to my profile'}
              </button>
              {cvSaveState.message && (
                <p role={cvSaveState.status === 'error' ? 'alert' : 'status'} className={cvSaveState.status === 'error' ? 'text-red-700 font-semibold' : 'text-emerald-900'}>
                  {cvSaveState.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. Job Drafter Assistant */}
      {activeTab === 'job_drafter' && allowed('job_drafter') && !entitlements.canUseAI && (
        <UpgradePrompt
          title="AI job description & screening assistant"
          description="Generate structured responsibilities, requirements and screening questions."
          planName="the Professional plan"
          onUpgrade={onOpenBilling}
        />
      )}
      {activeTab === 'job_drafter' && allowed('job_drafter') && entitlements.canUseAI && (
        <div className="bg-white p-6 rounded-3xl border border-[#E8E4D9] space-y-4">
          <div className="space-y-1">
            <h3 className="text-base font-serif font-bold text-[#132A13]">
              AI Job Description & Screening Assistant
            </h3>
            <p className="text-xs text-[#606C38]">
              Generate structured job responsibilities, key requirements, and tailored screening questions.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#283618] mb-1">
                Vacancy Title
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#283618] mb-1">
                Target County
              </label>
              <input
                type="text"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#283618] mb-1">
                Opportunity Type
              </label>
              <select
                value={oppType}
                onChange={(e) => setOppType(e.target.value)}
                className="w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-xs outline-none"
              >
                <option value="Job">Job</option>
                <option value="Tender">Tender</option>
                <option value="Consultancy">Consultancy</option>
                <option value="Scholarship">Scholarship</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#283618] mb-1">Your notes or rough draft (optional)</label>
            <textarea
              rows={4}
              value={jobNotes}
              onChange={(e) => setJobNotes(e.target.value)}
              maxLength={5000}
              placeholder="Key duties, must-have skills, salary range, anything the AI should include"
              className="w-full p-3 bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] text-xs outline-none"
            />
          </div>

          {draftError && <p role="alert" className="p-3 rounded-xl bg-red-50 text-red-800 text-xs">{draftError}</p>}

          <button
            onClick={handleRunJobAssistant}
            disabled={isDrafting}
            className="px-6 py-3 bg-[#283618] hover:bg-[#132A13] text-white font-bold rounded-xl text-xs transition-all flex items-center gap-2"
          >
            {isDrafting ? (
              <RefreshCw className="w-4 h-4 animate-spin text-[#DDA15E]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#DDA15E]" />
            )}
            <span>{isDrafting ? 'Generating Draft...' : 'Generate Opportunity Specification'}</span>
          </button>

          {draftResult && (
            <div className="p-5 bg-[#F9F8F4] rounded-2xl border border-[#D9E3D5] space-y-3 text-xs animate-in fade-in">
              <h4 className="font-bold text-[#132A13] text-sm">{draftResult.refinedTitle}</h4>
              <p className="text-[#2D2D2D] leading-relaxed">{draftResult.executiveSummary}</p>

              <div>
                <span className="font-bold text-[#283618] uppercase tracking-wider text-[10px]">
                  Core Responsibilities
                </span>
                <ul className="list-disc pl-4 space-y-1 text-[#2D2D2D] mt-1">
                  {draftResult.structuredResponsibilities?.map((resp: string, i: number) => (
                    <li key={i}>{resp}</li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="font-bold text-[#283618] uppercase tracking-wider text-[10px]">
                  Key Requirements
                </span>
                <ul className="list-disc pl-4 space-y-1 text-[#2D2D2D] mt-1">
                  {draftResult.keyRequirements?.map((req: string, i: number) => (
                    <li key={i}>{req}</li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="font-bold text-[#283618] uppercase tracking-wider text-[10px]">
                  Suggested Candidate Screening Questions
                </span>
                <div className="space-y-1.5 mt-1">
                  {draftResult.suggestedScreeningQuestions?.map((sq: any, i: number) => (
                    <div key={i} className="p-2.5 bg-white rounded-xl border border-[#E8E4D9]">
                      <p className="font-semibold text-[#132A13]">{i + 1}. {sq.question}</p>
                      <span className="text-[10px] text-[#606C38] uppercase">Type: {sq.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Audit Logs */}
      {activeTab === 'audit_logs' && allowed('audit_logs') && (
        <div className="bg-white p-6 rounded-3xl border border-[#E8E4D9] space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-serif font-bold text-[#132A13]">
                AI Operations & Non-Discrimination Audit Trail
              </h3>
              <p className="text-xs text-[#606C38]">
                Real-time log of AI invocations, provider routing, execution latencies, and candidate sanitization flags.
              </p>
            </div>

            <button
              onClick={refreshAuditLogs}
              className="p-2 bg-[#F9F8F4] hover:bg-[#ECF3E9] border border-[#D9E3D5] rounded-xl text-xs font-bold text-[#283618] flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Logs</span>
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-[#606C38] py-8 text-center bg-[#F9F8F4] rounded-2xl border border-[#E8E4D9]">
              No AI operations executed yet in this session. Try running an AI action above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#E8E4D9] bg-[#F9F8F4] text-[#606C38] font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Provider Used</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Latency</th>
                    <th className="p-3">Sanitized?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2F2EC]">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F9F8F4]/60 transition-colors">
                      <td className="p-3 text-[#606C38] font-mono text-[11px]">{log.timestamp.slice(11, 19)}</td>
                      <td className="p-3 font-bold text-[#132A13] capitalize">{log.action.replace('_', ' ')}</td>
                      <td className="p-3 text-[#283618]">{log.providerUsed}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                          log.status === 'success' ? 'bg-emerald-100 text-emerald-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="p-3 text-[#606C38] font-mono text-[11px]">{log.executionTimeMs}ms</td>
                      <td className="p-3">
                        {log.candidateSanitized ? (
                          <span className="text-emerald-700 font-bold flex items-center gap-1 text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            YES
                          </span>
                        ) : (
                          <span className="text-[#606C38]">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
