import { describe, it, expect, vi, beforeEach } from 'vitest';

const base = {
  momoMtnNumber: '', momoOrangeNumber: '', momoAccountName: '',
  momoMtnNumberUsd: '', momoMtnNumberLrd: '', momoOrangeNumberUsd: '', momoOrangeNumberLrd: '',
  momoAccountNameUsd: '', momoAccountNameLrd: '', momoLegacyNumbersAcceptLrd: false
};

async function load(overrides: Partial<typeof base>) {
  vi.resetModules();
  vi.doMock('../config/env', () => ({ envConfig: { ...base, ...overrides } }));
  return (await import('./paymentService')).getMomoInstructions;
}

describe('getMomoInstructions per currency', () => {
  beforeEach(() => vi.resetModules());

  it('legacy numbers keep working for USD but are NOT shown for LRD by default', async () => {
    const get = await load({ momoMtnNumber: '0770000001', momoAccountName: 'LibRise' });
    expect(get('manual_momo_mtn', 'USD')).toMatchObject({ configured: true, phoneNumber: '0770000001', currency: 'USD' });
    expect(get('manual_momo_mtn', 'LRD')).toMatchObject({ configured: false, phoneNumber: null });
    expect(get('manual_momo_mtn')).toMatchObject({ configured: true }); // legacy call shape = USD
  });

  it('uses the dedicated LRD account when configured, and never mixes currencies', async () => {
    const get = await load({
      momoMtnNumber: '0770000001', momoMtnNumberLrd: '0770000002', momoOrangeNumberLrd: '0550000003',
      momoAccountName: 'LibRise'
    });
    expect(get('manual_momo_mtn', 'LRD').phoneNumber).toBe('0770000002');
    expect(get('manual_momo_mtn', 'USD').phoneNumber).toBe('0770000001');
    expect(get('manual_momo_orange', 'LRD').phoneNumber).toBe('0550000003');
    expect(get('manual_momo_orange', 'USD')).toMatchObject({ configured: false, phoneNumber: null });
  });

  it('legacy number serves LRD only when the business explicitly says it can', async () => {
    const get = await load({ momoOrangeNumber: '0550000009', momoAccountName: 'LibRise', momoLegacyNumbersAcceptLrd: true });
    expect(get('manual_momo_orange', 'LRD')).toMatchObject({ configured: true, phoneNumber: '0550000009' });
  });

  it('per-currency account name overrides the shared one', async () => {
    const get = await load({ momoMtnNumberLrd: '0770000002', momoAccountName: 'Shared', momoAccountNameLrd: 'LibRise LRD' });
    expect(get('manual_momo_mtn', 'LRD').accountName).toBe('LibRise LRD');
  });

  it('needs an account name to be configured', async () => {
    const get = await load({ momoMtnNumberLrd: '0770000002' });
    expect(get('manual_momo_mtn', 'LRD').configured).toBe(false);
  });
});
