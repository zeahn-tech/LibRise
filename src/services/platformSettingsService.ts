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
}

export const EMPTY_PLATFORM_SETTINGS: PlatformSettings = { announcement: null, usdToLrd: null, extraIndustries: [] };

/** Turns raw key/value rows into typed settings, ignoring anything malformed. */
export function parsePlatformSettings(rows: Array<{ key: string; value: unknown }>): PlatformSettings {
  const out: PlatformSettings = { announcement: null, usdToLrd: null, extraIndustries: [] };
  for (const { key, value } of rows) {
    if (key === 'announcement' && value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v.enabled === 'boolean' && typeof v.message === 'string') {
        out.announcement = { enabled: v.enabled, message: v.message };
      }
    } else if (key === 'usd_to_lrd' && typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 1000) {
      out.usdToLrd = value;
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
  /** Never throws: if settings cannot be loaded the app simply uses its built-in defaults. */
  async load(): Promise<PlatformSettings> {
    const supabase = client();
    if (!supabase) return EMPTY_PLATFORM_SETTINGS;
    try {
      const { data, error } = await supabase.from('platform_settings').select('key,value');
      if (error || !data) return EMPTY_PLATFORM_SETTINGS;
      return parsePlatformSettings(data as Array<{ key: string; value: unknown }>);
    } catch {
      return EMPTY_PLATFORM_SETTINGS;
    }
  },

  async set(key: 'announcement' | 'usd_to_lrd' | 'extra_industries', value: unknown): Promise<void> {
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
