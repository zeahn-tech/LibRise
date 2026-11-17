import type { HelmetOptions } from 'helmet';

function originOf(value?: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy for the production server. The SPA ships no inline scripts, talks to
 * Supabase (HTTPS + realtime WebSocket) and, when the frontend is hosted elsewhere, to this API origin.
 * 'unsafe-inline' is allowed for styles only (React style attributes); scripts are same-origin only.
 */
export function buildCspDirectives(env: NodeJS.ProcessEnv = process.env): Record<string, string[]> {
  const connect = new Set<string>(["'self'"]);
  const supabase = originOf(env.VITE_SUPABASE_URL || env.SUPABASE_URL);
  if (supabase) {
    connect.add(supabase);
    connect.add(supabase.replace(/^https:/, 'wss:'));
  } else {
    connect.add('https://*.supabase.co');
    connect.add('wss://*.supabase.co');
  }
  const api = originOf(env.VITE_API_BASE_URL);
  if (api) connect.add(api);

  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [...connect],
    'media-src': ["'self'", 'blob:', 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': []
  };
}

export function buildHelmetOptions(env: NodeJS.ProcessEnv = process.env): HelmetOptions {
  const isProd = env.NODE_ENV === 'production';
  return {
    // CSP is enforced in production only; the dev server needs inline HMR scripts and the preview iframe.
    contentSecurityPolicy: isProd ? { useDefaults: false, directives: buildCspDirectives(env) } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false
  };
}
