import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Search, ShieldAlert, XCircle } from 'lucide-react';
import type { Opportunity, Organization } from '../../../types';
import { adminService, type OpportunityModerationStatus } from '../../../services/adminService';
import { useToast } from '../../../context/ToastContext';

type Filter = 'all' | 'review' | 'published' | 'quarantined' | 'rejected';

interface Props {
  opportunities: Opportunity[];
  organizations: Organization[];
  loading: boolean;
  error: string;
  /** Reloads the opportunity list and the audit trail after a decision. */
  onChanged: () => Promise<void> | void;
  onRetry: () => void;
}

const REASONS = [
  'Asks applicants to pay a fee',
  'Misleading or fake vacancy',
  'Duplicate listing',
  'Inappropriate or discriminatory content',
  'Missing or false employer details'
];

const modStatus = (o: Opportunity) => o.moderationStatus || 'published';

const PILL: Record<string, string> = {
  published: 'bg-green-100 text-green-800',
  pending_review: 'bg-amber-100 text-amber-800',
  flagged: 'bg-amber-100 text-amber-800',
  quarantined: 'bg-red-100 text-red-800',
  rejected: 'bg-red-100 text-red-800'
};

const matches = (o: Opportunity, f: Filter) =>
  f === 'all' ||
  (f === 'review' && (modStatus(o) === 'pending_review' || modStatus(o) === 'flagged')) ||
  modStatus(o) === f;

/**
 * Job moderation queue. Approve restores/publishes a vacancy; Quarantine and Reject take it down and REQUIRE a reason,
 * which is stored, written to the audit trail and sent to the employer as a notification.
 */
export const OpportunityModerationPanel: React.FC<Props> = ({ opportunities, organizations, loading, error, onChanged, onRetry }) => {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ opp: Opportunity; action: 'quarantined' | 'rejected' } | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const orgName = (o: Opportunity) => organizations.find((x) => x.id === o.organizationId)?.name || o.organization?.name || 'Unknown employer';

  const counts = useMemo(
    () => ({
      all: opportunities.length,
      review: opportunities.filter((o) => matches(o, 'review')).length,
      published: opportunities.filter((o) => matches(o, 'published')).length,
      quarantined: opportunities.filter((o) => matches(o, 'quarantined')).length,
      rejected: opportunities.filter((o) => matches(o, 'rejected')).length
    }),
    [opportunities]
  );

  const q = query.trim().toLowerCase();
  const list = opportunities.filter((o) => matches(o, filter) && (!q || o.title.toLowerCase().includes(q) || orgName(o).toLowerCase().includes(q)));

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && setTarget(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, submitting]);

  const decide = async (opp: Opportunity, status: OpportunityModerationStatus, note?: string) => {
    setBusyId(opp.id);
    try {
      await adminService.moderateOpportunity(opp.id, status, note);
      showToast(
        status === 'published' ? `“${opp.title}” approved. The employer has been notified.` : `“${opp.title}” ${status === 'quarantined' ? 'quarantined' : 'rejected'}. The employer has been notified.`,
        'success'
      );
      await onChanged();
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update this vacancy.', 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const submitReason = async () => {
    if (!target || submitting) return;
    if (reason.trim().length < 5) return;
    setSubmitting(true);
    const ok = await decide(target.opp, target.action, reason.trim());
    setSubmitting(false);
    if (ok) {
      setTarget(null);
      setReason('');
    }
  };

  const openDialog = (opp: Opportunity, action: 'quarantined' | 'rejected') => {
    setReason('');
    setTarget({ opp, action });
  };

  const deadline = (o: Opportunity) => (o.deadline && !isNaN(Date.parse(o.deadline)) ? new Date(o.deadline).toLocaleDateString() : 'No deadline');

  const pill = (o: Opportunity) => (
    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap ${PILL[modStatus(o)] || 'bg-stone-100 text-stone-700'}`}>
      {modStatus(o).replace(/_/g, ' ')}
    </span>
  );

  const actions = (o: Opportunity) => {
    const s = modStatus(o);
    const busy = busyId !== null;
    return (
      <div className="flex flex-wrap gap-2">
        {s !== 'published' && (
          <button
            type="button"
            onClick={() => decide(o, 'published')}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 min-h-11 bg-green-50 text-green-700 rounded-lg font-bold border border-green-200 hover:bg-green-100 transition-all cursor-pointer disabled:opacity-40"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> {s === 'quarantined' || s === 'rejected' ? 'Restore' : 'Approve'}
          </button>
        )}
        {s !== 'quarantined' && (
          <button
            type="button"
            onClick={() => openDialog(o, 'quarantined')}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 min-h-11 bg-red-50 text-red-700 rounded-lg font-bold border border-red-200 hover:bg-red-100 transition-all cursor-pointer disabled:opacity-40"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Quarantine
          </button>
        )}
        {(s === 'pending_review' || s === 'flagged') && (
          <button
            type="button"
            onClick={() => openDialog(o, 'rejected')}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 min-h-11 bg-white text-stone-700 rounded-lg font-bold border border-stone-300 hover:bg-stone-50 transition-all cursor-pointer disabled:opacity-40"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
        )}
      </div>
    );
  };

  const note = (o: Opportunity) =>
    o.moderationNote && modStatus(o) !== 'published' ? (
      <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1 mt-1.5 break-words">Reason: {o.moderationNote}</p>
    ) : null;

  const chips: Array<[Filter, string]> = [
    ['all', 'All'],
    ['review', 'Needs review'],
    ['published', 'Published'],
    ['quarantined', 'Quarantined'],
    ['rejected', 'Rejected']
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <h3 className="font-serif font-bold text-2xl text-[#132A13]">Job Vacancy & Opportunity Moderation</h3>
          <p className="text-stone-500 text-sm">Approve genuine vacancies, or quarantine listings that charge applicants fees or look fake. Employers are notified of every decision.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-3 w-4 h-4 text-stone-400" />
          <input
            type="text"
            aria-label="Search vacancies"
            placeholder="Search vacancies..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-4 min-h-11 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]"
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Moderation status filter">
        {chips.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={`shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full text-xs font-bold border cursor-pointer ${
              filter === key ? 'bg-[#283618] text-white border-[#283618]' : 'bg-white text-[#606C38] border-[#E8E4D9] hover:border-[#4F772D]'
            }`}
          >
            {label}
            <span className={`px-1.5 rounded-full text-[10px] ${filter === key ? 'bg-white/20' : 'bg-[#F2F2EC]'} ${key === 'review' && counts.review > 0 ? 'text-[#BC6C25]' : ''}`}>{counts[key]}</span>
          </button>
        ))}
      </div>

      {loading && opportunities.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">Loading…</p>
      ) : error ? (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="px-4 min-h-11 rounded-xl bg-red-600 text-white text-xs font-bold self-start cursor-pointer">Retry</button>
        </div>
      ) : opportunities.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">No job opportunities have been posted yet.</p>
      ) : list.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500">{q ? 'No vacancies match your search.' : 'Nothing in this status.'}</p>
      ) : (
        <>
          <p className="text-[11px] text-stone-500 font-semibold">{list.length} of {opportunities.length} opportunities</p>
          <div className="md:hidden space-y-3">
            {list.map((o) => (
              <div key={o.id} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-[#283618] text-sm break-words">{o.title}</p>
                    <p className="text-xs text-stone-600 font-semibold">{orgName(o)}</p>
                    <p className="text-[11px] text-stone-500">{o.county} County · Deadline {deadline(o)}</p>
                  </div>
                  {pill(o)}
                </div>
                {note(o)}
                <div className="text-xs">{actions(o)}</div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Employer Org</th>
                  <th className="py-3 px-4">County</th>
                  <th className="py-3 px-4">Moderation Status</th>
                  <th className="py-3 px-4">Deadline</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E4D9]">
                {list.map((o) => (
                  <tr key={o.id} className="hover:bg-stone-50/50 align-top">
                    <td className="py-3.5 px-4 font-bold text-[#283618]">
                      {o.title}
                      {note(o)}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-stone-700">{orgName(o)}</td>
                    <td className="py-3.5 px-4 text-stone-600 whitespace-nowrap">{o.county} County</td>
                    <td className="py-3.5 px-4">{pill(o)}</td>
                    <td className="py-3.5 px-4 text-stone-500 whitespace-nowrap">{deadline(o)}</td>
                    <td className="py-3.5 px-4 text-right"><div className="flex justify-end">{actions(o)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {target && (
        <div role="dialog" aria-modal="true" aria-label={target.action === 'quarantined' ? 'Quarantine vacancy' : 'Reject vacancy'} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
          <div className="bg-white w-full max-w-lg rounded-3xl border border-[#E8E4D9] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto overscroll-contain">
            <div>
              <h3 className="font-serif font-bold text-lg text-[#132A13]">{target.action === 'quarantined' ? 'Quarantine this vacancy' : 'Reject this vacancy'}</h3>
              <p className="text-xs text-stone-600 mt-0.5 break-words">“{target.opp.title}” · {orgName(target.opp)}</p>
              <p className="text-xs text-stone-500 mt-2">The vacancy is taken off the public listings immediately and the employer is notified with your reason. You can restore it later.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="min-h-9 px-3 rounded-full border border-[#E8E4D9] bg-[#F9F8F6] text-[11px] font-semibold text-stone-700 hover:border-[#4F772D] cursor-pointer">
                  {r}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="moderation-reason" className="block text-xs font-bold text-[#283618] mb-1">Reason shown to the employer *</label>
              <textarea
                id="moderation-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full p-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D] resize-none"
                placeholder="Explain what needs to change before this vacancy can be restored."
              />
              <p className="text-[11px] text-stone-400 mt-1">At least 5 characters.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={submitting} onClick={() => setTarget(null)} className="min-h-11 px-4 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer">Cancel</button>
              <button
                type="button"
                disabled={submitting || reason.trim().length < 5}
                onClick={submitReason}
                className="min-h-11 px-5 text-xs font-bold text-white rounded-xl bg-red-700 hover:bg-red-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Saving…' : target.action === 'quarantined' ? 'Quarantine vacancy' : 'Reject vacancy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
