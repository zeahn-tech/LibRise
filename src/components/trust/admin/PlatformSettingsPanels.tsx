import React, { useEffect, useState } from 'react';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { BUSINESS_INDUSTRIES } from '../../../config/constants';
import { useToast } from '../../../context/ToastContext';
import { formatConverted, getUsdToLrdRate } from '../../../lib/currency';
import { mergeIndustries, refreshPlatformSettings, useMaxJobDays, usePlatformSettings } from '../../../lib/platformSettingsStore';
import { DEFAULT_MAX_JOB_DAYS, describeLimit, MAX_MAX_JOB_DAYS, MIN_MAX_JOB_DAYS } from '../../../lib/jobExpiry';
import { platformSettingsService } from '../../../services/platformSettingsService';
import { EXCHANGE_RATES } from '../../../config/constants';

type SettingKey = Parameters<typeof platformSettingsService.set>[0];

/** Saves a setting, then reads settings back so a save that visitors cannot actually see is reported, not hidden. */
async function saveSetting(key: SettingKey, value: unknown): Promise<void> {
  await platformSettingsService.set(key, value);
  try {
    await refreshPlatformSettings(true);
  } catch (err) {
    const why = err instanceof Error ? err.message : 'unknown error';
    throw new Error(`Saved, but it could not be read back (${why}). Visitors will not see it until this is fixed. Check that the latest database migration has been run.`);
  }
}

const input = 'w-full min-h-11 px-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D]';
const primaryBtn = 'inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl bg-[#283618] hover:bg-[#132A13] text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

/** Industries available in the business listing form and the marketplace filter (built-in list + admin additions). */
export const IndustriesPanel: React.FC = () => {
  const { showToast } = useToast();
  const { extraIndustries } = usePlatformSettings();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (next: string[], success: string) => {
    setBusy(true);
    try {
      await saveSetting('extra_industries', next);
      showToast(success, 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save industries.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (value.length < 2 || value.length > 60) {
      showToast('Industry names must be 2 to 60 characters.', 'error');
      return;
    }
    if (mergeIndustries(extraIndustries).some((i) => i.toLowerCase() === value.toLowerCase())) {
      showToast(`“${value}” is already in the list.`, 'error');
      return;
    }
    if (await save([...extraIndustries, value], `Added “${value}”. It is now available in business listings.`)) setName('');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-2xl text-[#132A13]">Business Industries</h3>
        <p className="text-stone-500 text-sm">Industries shown when someone lists a business for sale and in the marketplace filter. Removing an industry does not change listings that already use it.</p>
      </div>

      <form onSubmit={add} className="flex flex-col sm:flex-row gap-3 sm:items-end max-w-xl">
        <div className="flex-1">
          <label htmlFor="new-industry" className="block text-xs font-bold text-[#283618] mb-1">Add an industry</label>
          <input id="new-industry" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fisheries & Aquaculture" className={input} />
        </div>
        <button type="submit" disabled={busy || name.trim().length < 2} className={primaryBtn}>
          <Plus className="w-4 h-4" /> Add industry
        </button>
      </form>

      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">Added by administrators ({extraIndustries.length})</h4>
        {extraIndustries.length === 0 ? (
          <p className="text-sm text-stone-500">None yet. Only the built-in industries are available.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {extraIndustries.map((ind) => (
              <li key={ind} className="inline-flex items-center gap-1 pl-3 pr-1 min-h-11 rounded-full bg-[#ECF3E9] border border-[#D9E3D5] text-xs font-bold text-[#283618]">
                {ind}
                <button type="button" disabled={busy} onClick={() => save(extraIndustries.filter((i) => i !== ind), `Removed “${ind}”.`)} aria-label={`Remove ${ind}`} className="min-w-9 min-h-9 flex items-center justify-center rounded-full text-red-700 hover:bg-red-50 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">Built in ({BUSINESS_INDUSTRIES.length})</h4>
        <ul className="flex flex-wrap gap-2">
          {BUSINESS_INDUSTRIES.map((ind) => (
            <li key={ind} className="px-3 py-1.5 rounded-full bg-[#F9F8F6] border border-[#E8E4D9] text-xs font-semibold text-stone-600">{ind}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/** The site-wide announcement banner. What is saved here is exactly what every visitor sees. */
export const AnnouncementPanel: React.FC = () => {
  const { showToast } = useToast();
  const { announcement } = usePlatformSettings();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(announcement?.enabled ?? false);
    setMessage(announcement?.message ?? '');
  }, [announcement]);

  const dirty = enabled !== (announcement?.enabled ?? false) || message.trim() !== (announcement?.message ?? '');
  const invalid = enabled && message.trim().length === 0;

  const save = async () => {
    if (invalid || busy) return;
    setBusy(true);
    try {
      await saveSetting('announcement', { enabled, message: message.trim() });
      showToast(enabled ? 'Announcement is now live for all visitors.' : 'Announcement saved and switched off.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the announcement.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-2xl text-[#132A13]">Site Announcement</h3>
        <p className="text-stone-500 text-sm">A short notice shown at the top of LibRise to every visitor, for example about maintenance windows or important rule changes.</p>
      </div>

      <label className="flex items-center gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-5 h-5 accent-[#4F772D]" />
        <span className="text-sm font-bold text-[#283618]">Show the announcement</span>
      </label>

      <div>
        <label htmlFor="announcement-message" className="block text-xs font-bold text-[#283618] mb-1">Message</label>
        <textarea id="announcement-message" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} className={`${input} py-3 resize-none`} placeholder="e.g. LibRise will be briefly unavailable on Sunday from 02:00 to 03:00 for maintenance." />
        <div className="flex justify-between text-[11px] text-stone-400 mt-1">
          <span>{invalid ? <span className="text-red-700 font-semibold">A message is required to show the announcement.</span> : 'Plain text only.'}</span>
          <span>{message.length}/300</span>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Preview</p>
        {enabled && message.trim() ? (
          <div className="px-4 py-3 bg-[#FEFAE0] border border-[#E8D9A8] rounded-2xl flex items-start gap-3 text-xs font-semibold text-[#283618] break-words">
            <Megaphone className="w-4 h-4 text-[#BC6C25] shrink-0 mt-0.5" /> <span>{message.trim()}</span>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Nothing is shown to visitors right now.</p>
        )}
      </div>

      <button type="button" onClick={save} disabled={!dirty || invalid || busy} className={primaryBtn}>{busy ? 'Saving…' : 'Save announcement'}</button>
    </div>
  );
};

/** The one platform setting that is wired into the app: the USD to LRD rate used wherever prices are shown in both. */
export const ExchangeRatePanel: React.FC = () => {
  const { showToast } = useToast();
  const { usdToLrd } = usePlatformSettings();
  const current = usdToLrd ?? EXCHANGE_RATES.USD_TO_LRD;
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(String(current)), [current]);

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed >= 50 && parsed <= 1000;
  const dirty = valid && parsed !== current;

  const save = async (rate: number, message: string) => {
    setBusy(true);
    try {
      await saveSetting('usd_to_lrd', rate);
      showToast(message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the exchange rate.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-2xl text-[#132A13]">Platform Configuration</h3>
        <p className="text-stone-500 text-sm">The USD to Liberian dollar rate used wherever LibRise shows prices in both currencies. It changes how prices are displayed; payments are still made for the fixed prices on the Subscriptions page.</p>
      </div>

      <div>
        <label htmlFor="usd-lrd" className="block text-xs font-bold text-[#283618] mb-1">1 USD equals (LRD)</label>
        <input id="usd-lrd" type="number" inputMode="decimal" min={50} max={1000} step="0.5" value={value} onChange={(e) => setValue(e.target.value)} className={input} aria-invalid={!valid} />
        <p className={`text-[11px] mt-1 ${valid ? 'text-stone-400' : 'text-red-700 font-semibold'}`}>
          {valid ? `Live rate: 1 USD = ${getUsdToLrdRate()} LRD. Example: $100 = ${formatConverted(100, 'USD', 'LRD')}.` : 'Enter a rate between 50 and 1000.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!dirty || busy} onClick={() => save(parsed, `Exchange rate set to 1 USD = ${parsed} LRD.`)} className={primaryBtn}>{busy ? 'Saving…' : 'Save rate'}</button>
        {usdToLrd !== null && usdToLrd !== EXCHANGE_RATES.USD_TO_LRD && (
          <button type="button" disabled={busy} onClick={() => save(EXCHANGE_RATES.USD_TO_LRD, `Rate reset to the built-in 1 USD = ${EXCHANGE_RATES.USD_TO_LRD} LRD.`)} className="min-h-11 px-5 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer">
            Reset to {EXCHANGE_RATES.USD_TO_LRD}
          </button>
        )}
      </div>
    </div>
  );
};

/** Maximum job expiry: how far ahead an employer may set a vacancy's application deadline. */
export const MaxJobExpiryPanel: React.FC = () => {
  const { showToast } = useToast();
  const maxJobDays = useMaxJobDays();
  const [value, setValue] = useState(String(maxJobDays));
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(String(maxJobDays)), [maxJobDays]);

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= MIN_MAX_JOB_DAYS && parsed <= MAX_MAX_JOB_DAYS;
  const dirty = valid && parsed !== maxJobDays;

  const save = async (days: number, message: string) => {
    setBusy(true);
    try {
      await saveSetting('max_job_days', days);
      showToast(message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the limit.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="space-y-1">
        <h3 className="font-serif font-bold text-2xl text-[#132A13]">Maximum Job Expiry</h3>
        <p className="text-stone-500 text-sm">The longest an employer may keep a vacancy open. Applications close on the deadline, so this stops vacancies from staying listed for months or years.</p>
      </div>

      <div>
        <label htmlFor="max-job-days" className="block text-xs font-bold text-[#283618] mb-1">Longest allowed deadline (days from today)</label>
        <input id="max-job-days" type="number" inputMode="numeric" min={MIN_MAX_JOB_DAYS} max={MAX_MAX_JOB_DAYS} step="1" value={value} onChange={(e) => setValue(e.target.value)} className={input} aria-invalid={!valid} />
        <p className={`text-[11px] mt-1 ${valid ? 'text-stone-400' : 'text-red-700 font-semibold'}`}>
          {valid ? `Live limit: ${maxJobDays} days. Employers will see: ${describeLimit(parsed)}` : `Enter a whole number from ${MIN_MAX_JOB_DAYS} to ${MAX_MAX_JOB_DAYS}.`}
        </p>
      </div>

      <ul className="text-xs text-stone-600 space-y-1 list-disc pl-5">
        <li>Checked when a vacancy is created, when its deadline changes, or when it is published again.</li>
        <li>Existing vacancies are not changed, and editing something else on an older vacancy is never blocked.</li>
        <li>Platform administrators can override the limit.</li>
      </ul>

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!dirty || busy} onClick={() => save(parsed, `Vacancies can now stay open for up to ${parsed} days.`)} className={primaryBtn}>{busy ? 'Saving…' : 'Save limit'}</button>
        {maxJobDays !== DEFAULT_MAX_JOB_DAYS && (
          <button type="button" disabled={busy} onClick={() => save(DEFAULT_MAX_JOB_DAYS, `Limit reset to the default of ${DEFAULT_MAX_JOB_DAYS} days.`)} className="min-h-11 px-5 rounded-xl border border-[#E8E4D9] text-xs font-bold text-[#283618] hover:bg-[#F9F8F6] cursor-pointer">
            Reset to {DEFAULT_MAX_JOB_DAYS}
          </button>
        )}
      </div>
    </div>
  );
};
