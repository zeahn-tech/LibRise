import { describe, it, expect } from 'vitest';
import { validateTransactionId, validateSenderPhone } from './paymentValidation';

describe('validateTransactionId', () => {
  it.each(['MP240101.1234.A12345', 'txn-abc-12345', '84730192645', 'TXN-LATE-1'])('accepts %s', (id) => {
    expect(validateTransactionId(id, 'OHL-AB12-CD34').ok).toBe(true);
  });

  it.each(['12345', '11111111', '12121212', '12345678', '98765432', '1234567890123', 'abc def!!1234', ''])(
    'rejects junk %j',
    (id) => {
      expect(validateTransactionId(id, 'OHL-AB12-CD34').ok).toBe(false);
    }
  );

  it('rejects our own reference code', () => {
    expect(validateTransactionId('ohl-ab12-cd34', 'OHL-AB12-CD34').ok).toBe(false);
  });

  it('rejects the payer phone number used as an ID', () => {
    expect(validateTransactionId('0770123456', 'OHL-AB12-CD34', '0770123456').ok).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(validateTransactionId(' txn-abc 12345 ').value).toBe('TXN-ABC12345');
  });
});

describe('validateSenderPhone', () => {
  it('normalises common formats', () => {
    expect(validateSenderPhone('+231 770-000-000').value).toBe('+231770000000');
    expect(validateSenderPhone('0770000000').ok).toBe(true);
  });
  it.each(['', 'abc', '12345', '+1234567890123456'])('rejects %j', (p) => {
    expect(validateSenderPhone(p).ok).toBe(false);
  });
});
