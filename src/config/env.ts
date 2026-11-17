export interface AppConfig {
  appEnv: 'development' | 'staging' | 'production' | 'test';
  apiBaseUrl: string;
  defaultCurrency: 'USD' | 'LRD';
  enableLowBandwidthMode: boolean;
  pwaEnabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  enableDemoMode: boolean;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  /** Real business mobile money numbers for the manual-review payment
   *  flow (see src/services/paymentService.ts). Deliberately left empty
   *  by default rather than a placeholder-looking value -- a fake-looking
   *  number here would be actively misleading, unlike an empty one that
   *  the UI can correctly show as "not yet configured". */
  momoMtnNumber: string;
  momoOrangeNumber: string;
  momoAccountName: string;
  /** Optional per-currency receiving accounts. A number that can receive USD may not be able to receive LRD
   *  (and vice versa), so the business can configure each network+currency separately. Empty = not configured. */
  momoMtnNumberUsd: string;
  momoMtnNumberLrd: string;
  momoOrangeNumberUsd: string;
  momoOrangeNumberLrd: string;
  /** Optional per-currency account-name overrides (fall back to momoAccountName). */
  momoAccountNameUsd: string;
  momoAccountNameLrd: string;
  /** Set to true ONLY if the legacy VITE_MOMO_*_NUMBER numbers can really receive LRD too. */
  momoLegacyNumbersAcceptLrd: boolean;
}

function parseBoolean(val: string | undefined, defaultValue: boolean): boolean {
  if (val === undefined || val === null || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

function loadConfig(): AppConfig {
  const env = (import.meta.env.VITE_APP_ENV || import.meta.env.MODE || 'development') as AppConfig['appEnv'];
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
  // Display currency default: an explicit VITE_DEFAULT_CURRENCY wins; unset means LRD in production, USD elsewhere.
  const explicitCurrency = String(import.meta.env.VITE_DEFAULT_CURRENCY || '').toUpperCase();
  const defaultCurrency = (explicitCurrency === 'LRD' || explicitCurrency === 'USD'
    ? explicitCurrency
    : env === 'production' ? 'LRD' : 'USD') as 'USD' | 'LRD';
  const enableLowBandwidthMode = parseBoolean(import.meta.env.VITE_ENABLE_LOW_BANDWIDTH_MODE, false);
  const pwaEnabled = parseBoolean(import.meta.env.VITE_PWA_ENABLED, true);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const momoMtnNumber = import.meta.env.VITE_MOMO_MTN_NUMBER || '';
  const momoOrangeNumber = import.meta.env.VITE_MOMO_ORANGE_NUMBER || '';
  const momoAccountName = import.meta.env.VITE_MOMO_ACCOUNT_NAME || '';
  const momoMtnNumberUsd = import.meta.env.VITE_MOMO_MTN_NUMBER_USD || '';
  const momoMtnNumberLrd = import.meta.env.VITE_MOMO_MTN_NUMBER_LRD || '';
  const momoOrangeNumberUsd = import.meta.env.VITE_MOMO_ORANGE_NUMBER_USD || '';
  const momoOrangeNumberLrd = import.meta.env.VITE_MOMO_ORANGE_NUMBER_LRD || '';
  const momoAccountNameUsd = import.meta.env.VITE_MOMO_ACCOUNT_NAME_USD || '';
  const momoAccountNameLrd = import.meta.env.VITE_MOMO_ACCOUNT_NAME_LRD || '';
  const momoLegacyNumbersAcceptLrd = parseBoolean(import.meta.env.VITE_MOMO_LEGACY_NUMBERS_ACCEPT_LRD, false);

  const isProd = env === 'production';
  const isDev = env === 'development' || env === 'test';

  // Demo mode defaults to true in development/test, but strictly false in production/staging unless explicitly overridden for testing
  const defaultDemoMode = isDev;
  const enableDemoMode = parseBoolean(import.meta.env.VITE_ENABLE_DEMO_MODE, defaultDemoMode);

  return Object.freeze({
    appEnv: env,
    apiBaseUrl,
    defaultCurrency,
    enableLowBandwidthMode,
    pwaEnabled,
    supabaseUrl,
    supabaseAnonKey,
    enableDemoMode,
    isProduction: isProd,
    isDevelopment: isDev,
    isTest: env === 'test',
    momoMtnNumber,
    momoOrangeNumber,
    momoAccountName,
    momoMtnNumberUsd,
    momoMtnNumberLrd,
    momoOrangeNumberUsd,
    momoOrangeNumberLrd,
    momoAccountNameUsd,
    momoAccountNameLrd,
    momoLegacyNumbersAcceptLrd
  });
}

export const envConfig: AppConfig = loadConfig();

