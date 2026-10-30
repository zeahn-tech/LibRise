/**
 * platformSettingsService.ts
 *
 * Site-wide settings an administrator can change (public.platform_settings). Reads are open to everyone (every key is
 * public-safe by construction); writes only go through the admin_set_platform_setting RPC, which refuses anyone who
 * is not a platform administrator and validates each key's shape on the server.
 *
 *   announcement      { enabled, message }  shown as a banner to every visitor
 *   usd_to_lrd        number (50 to 1000)   the USD -> LRD display rate
 *   extra_industries  string[]              business industries added on top of the built-in list
 *   max_job_days      integer (7 to 365)    longest an application deadline may be from today (default 90)
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { toDbError } from './dbErrors';
import { ForbiddenError } from '../core/errors/AppError';

export interface Announcement {
  enabled: boolean;
  message: string;
}

export interface PlatformSettings {
  announcement: Announcement | null;
  usdToLrd: number | null;
  extraIndustries: string[];
  /** Longest a vacancy's application deadline may be from today; null means the built-in default (90 days). */
  maxJobDays: number | null;
}

export const EMPTY_PLATFORM_SETTINGS: PlatformSettings = { announcement: null, usdToLrd: null, extraIndustries: [], maxJobDays: null };

/** Turns raw key/value rows into typed settings, ignoring anything malformed. */
export function parsePlatformSettings(rows: Array<{ key: string; value: unknown }>): PlatformSettings {
  const out: PlatformSettings = { announcement: null, usdToLrd: null, extraIndustries: [], maxJobDays: null };
  for (const { key, value } of rows) {
    if (key === 'announcement' && value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v.enabled === 'boolean' && typeof v.message === 'string') {
        out.announcement = { enabled: v.enabled, message: v.message };
      }
    } else if (key === 'usd_to_lrd' && typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 1000) {
      out.usdToLrd = value;
    } else if (key === 'max_job_days' && typeof value === 'number' && Number.isInteger(value) && value >= 7 && value <= 365) {
      out.maxJobDays = value;
    } else if (key === 'extra_industries' && Array.isArray(value)) {
      out.extraIndustries = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
  }
  return out;
}

function client() {
  return getSupabaseClient();
}

export const platformSettingsService = {
  /**
   * Visitors: never throws. If settings cannot be read the app uses its built-in defaults (and logs why, so a broken
   * setup is diagnosable instead of silent).
   * Admin saves pass { strict: true } so a settings table that cannot be read back is reported, not hidden.
   */
  async load(options: { strict?: boolean } = {}): Promise<PlatformSettings> {
    const supabase = client();
    if (!supabase) {
      if (options.strict) throw new Error('The platform is not connected to its database.');
      return EMPTY_PLATFORM_SETTINGS;
    }
    try {
      const { data, error } = await supabase.from('platform_settings').select('key,value');
      if (error || !data) throw new Error(error?.message || 'No data returned.');
      return parsePlatformSettings(data as Array<{ key: string; value: unknown }>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options.strict) throw new Error(message);
      console.warn('[platform settings] could not be loaded; using built-in defaults:', message);
      return EMPTY_PLATFORM_SETTINGS;
    }
  },

  async set(key: 'announcement' | 'usd_to_lrd' | 'extra_industries' | 'max_job_days', value: unknown): Promise<void> {
    const supabase = client();
    if (!supabase) throw new Error('Settings can only be saved when the platform is connected to its database.');
    const { error } = await supabase.rpc('admin_set_platform_setting', { p_key: key, p_value: value });
    if (error) {
      if (error.code === '42501') throw new ForbiddenError(error.message);
      if (error.code === '22023') throw new Error(error.message);
      throw toDbError('platformSettingsService', error);
    }
  }
};
