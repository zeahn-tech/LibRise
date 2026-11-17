import { describe, it, expect } from 'vitest';
import { readAuthEnv } from '../server/authMiddleware';
import { buildCspDirectives, buildHelmetOptions } from '../../server/securityHeaders';

describe('F-04 demo mode is never honoured by a production server', () => {
  it('enables demo fallback only outside production', () => {
    expect(readAuthEnv({ VITE_ENABLE_DEMO_MODE: 'true', NODE_ENV: 'development' } as any).demoModeEnabled).toBe(true);
    expect(readAuthEnv({ VITE_ENABLE_DEMO_MODE: 'true', NODE_ENV: 'production' } as any).demoModeEnabled).toBe(false);
    expect(readAuthEnv({ NODE_ENV: 'development' } as any).demoModeEnabled).toBe(false);
  });
});

describe('F-07 content security policy', () => {
  const env = {
    NODE_ENV: 'production',
    VITE_SUPABASE_URL: 'https://abc.supabase.co',
    VITE_API_BASE_URL: 'https://api.example.org/api'
  } as any;

  it('is enforced in production and off in development', () => {
    expect(buildHelmetOptions(env).contentSecurityPolicy).toBeTruthy();
    expect(buildHelmetOptions({ NODE_ENV: 'development' } as any).contentSecurityPolicy).toBe(false);
  });

  it('restricts scripts, objects and framing', () => {
    const d = buildCspDirectives(env);
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
  });

  it('allows only this app, Supabase (https + wss) and the configured API origin to be contacted', () => {
    const c = buildCspDirectives(env)['connect-src'];
    expect(c).toEqual(expect.arrayContaining(["'self'", 'https://abc.supabase.co', 'wss://abc.supabase.co', 'https://api.example.org']));
    expect(c).toHaveLength(4);
  });
});
