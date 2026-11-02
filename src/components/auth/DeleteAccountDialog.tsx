import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { accountService, AccountDeletionError, type DeletionBlocker, type ServerStatus } from '../../services/accountService';

interface Props {
  onClose: () => void;
  /** Called after the account is deleted and the person acknowledges: the parent signs out. */
  onFinished: () => void;
}

const DELETED = [
  'Your profile, CV and saved items',
  'Applications you submitted (employers keep any copies they already downloaded)',
  'Business listings you posted, and your business enquiries and saved listings',
  'Your notifications and team memberships',
  'Every file you uploaded: CVs, certificates, verification documents and message attachments',
  'Your sign-in account. You can register again later with the same email.'
];

const KEPT = [
  'Messages you sent stay visible to the people you sent them to, shown as from “Deleted user”',
  'Payment records, safety reports and the audit trail, which we must keep for accounting and security',
  'An organization you were the only member of stays, but its vacancies are closed'
];

/** Confirms and performs deleting the signed-in person's own account. */
export const DeleteAccountDialog: React.FC<Props> = ({ onClose, onFinished }) => {
  const [blockers, setBlockers] = useState<DeletionBlocker[] | null>(null);
  const [checkError, setCheckError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ warnings: string[] } | null>(null);
  const [server, setServer] = useState<'checking' | ServerStatus>('checking');
  const [serverCheck, setServerCheck] = useState(0);

  // Find out BEFORE the person types a password whether the server can be reached (it may be waking up).
  useEffect(() => {
    let cancelled = false;
    setServer('checking');
    accountService.checkServer().then((status) => !cancelled && setServer(status));
    return () => {
      cancelled = true;
    };
  }, [serverCheck]);

  useEffect(() => {
    let cancelled = false;
    accountService
      .getDeletionBlockers()
      .then((b) => !cancelled && setBlockers(b))
      .catch((e) => !cancelled && setCheckError(e instanceof Error ? e.message : 'Could not check your account.'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && !done && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, done, onClose]);

  const canSubmit = blockers !== null && blockers.length === 0 && server === 'ready' && password.length > 0 && confirmText === 'DELETE' && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      setDone(await accountService.deleteMyAccount(password, confirmText));
    } catch (err) {
      if (err instanceof AccountDeletionError && err.blockers.length > 0) setBlockers(err.blockers);
      setError(err instanceof Error ? err.message : 'Your account could not be deleted.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Delete account" className="fixed inset-0 z-[80] bg-[#132A13]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
      <div className="relative w-full max-w-lg bg-white rounded-3xl border border-[#E8E4D9] shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        <div className="flex-none relative px-5 sm:px-6 pt-5 pb-4 pr-16 border-b border-[#E8E4D9] bg-red-50">
          {!done && (
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/80 hover:bg-white flex items-center justify-center text-[#283618] border border-red-100 cursor-pointer disabled:opacity-50">
              <X className="w-5 h-5" />
            </button>
          )}
          <h3 className="font-serif font-bold text-xl text-red-900 flex items-center gap-2">
            {done ? <CheckCircle2 className="w-5 h-5 text-green-700 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
            {done ? 'Your account was deleted' : 'Delete your account'}
          </h3>
          {!done && <p className="text-xs text-red-800 mt-1">This cannot be undone.</p>}
        </div>

        {done ? (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-3 text-sm text-[#2D2D2D]">
              <p>Your data has been removed and you have been signed out. Thank you for using LibRise.</p>
              {done.warnings.length > 0 && (
                <p className="text-xs bg-[#FEFAE0] border border-[#E8D9A8] rounded-xl p-3 text-[#283618]">
                  Your account is closed and cannot be used. A few clean-up steps could not finish right now and will be completed by our team. If you want confirmation, contact support.
                </p>
              )}
            </div>
            <div className="flex-none px-5 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#E8E4D9] bg-white flex justify-end">
              <button type="button" onClick={onFinished} className="min-h-11 px-6 rounded-xl bg-[#283618] hover:bg-[#132A13] text-white text-xs font-bold cursor-pointer">Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-5">
              {blockers === null && !checkError && (
                <p className="text-xs text-[#606C38] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking your account…</p>
              )}
              {server === 'checking' && (
                <p className="text-xs text-[#606C38] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Contacting the server… this can take up to a minute if it was asleep.</p>
              )}
              {server === 'blocked' && (
                <div role="alert" className="rounded-2xl border border-[#E8D9A8] bg-[#FEFAE0] p-4 space-y-2">
                  <p className="text-xs text-[#283618]">
                    The LibRise server is running, but it is not set up to accept requests from this website. This is a setup problem, not something you did wrong, and your account cannot be deleted until it is fixed. Please contact support.
                  </p>
                  <p className="text-[11px] text-[#606C38]">
                    For the administrator: add <strong className="break-all">{window.location.origin}</strong> to the server’s <code>ALLOWED_ORIGINS</code> setting.
                  </p>
                  <button type="button" onClick={() => setServerCheck((n) => n + 1)} className="min-h-11 px-4 rounded-xl border border-[#E8D9A8] bg-white text-xs font-bold text-[#283618] hover:bg-[#FEFAE0] cursor-pointer">
                    Check again
                  </button>
                </div>
              )}
              {server === 'unreachable' && (
                <div role="alert" className="rounded-2xl border border-[#E8D9A8] bg-[#FEFAE0] p-4 space-y-2">
                  <p className="text-xs text-[#283618]">
                    We can’t reach the LibRise server right now, so your account can’t be deleted yet. It may still be starting up: wait a minute and check again. If this keeps happening, please contact support.
                  </p>
                  <button type="button" onClick={() => setServerCheck((n) => n + 1)} className="min-h-11 px-4 rounded-xl border border-[#E8D9A8] bg-white text-xs font-bold text-[#283618] hover:bg-[#FEFAE0] cursor-pointer">
                    Check again
                  </button>
                </div>
              )}
              {checkError && <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">{checkError}</p>}

              {blockers !== null && blockers.length > 0 && (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
                  <p className="text-xs font-bold text-red-900">Before you can delete your account:</p>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs text-red-900">
                    {blockers.map((b) => (
                      <li key={b.code}>{b.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#A3B18A] mb-1.5">What will be deleted</p>
                  <ul className="list-disc pl-5 space-y-1 text-xs text-[#2D2D2D] marker:text-red-500">
                    {DELETED.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[#A3B18A] mb-1.5">What we keep</p>
                  <ul className="list-disc pl-5 space-y-1 text-xs text-[#2D2D2D] marker:text-[#A3B18A]">
                    {KEPT.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="delete-password" className="block text-xs font-bold text-[#283618] mb-1">Your password</label>
                  <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy || (blockers?.length ?? 0) > 0}
                    className="w-full min-h-11 px-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D] disabled:opacity-50" />
                </div>
                <div>
                  <label htmlFor="delete-confirm" className="block text-xs font-bold text-[#283618] mb-1">Type DELETE to confirm</label>
                  <input id="delete-confirm" type="text" autoComplete="off" autoCapitalize="characters" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={busy || (blockers?.length ?? 0) > 0}
                    className="w-full min-h-11 px-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D] disabled:opacity-50" />
                </div>
                {error && <p role="alert" className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}
              </div>
            </div>

            <div className="flex-none px-5 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#E8E4D9] bg-white flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="min-h-11 px-5 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer disabled:opacity-50">Keep my account</button>
              <button type="submit" disabled={!canSubmit} className="min-h-11 px-5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} {busy ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
