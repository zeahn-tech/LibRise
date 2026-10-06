/**
 * Client-side mirror of the server-side checks in
 * supabase/migrations/20261006100000_harden_payment_reference_and_subscription_expiry.sql
 * (normalize_momo_transaction_id / normalize_sender_phone).
 *
 * This exists ONLY to give people instant, readable feedback. The database
 * re-runs the same rules inside submit_payment_reference(), so skipping or
 * editing this file can never let a bad value through. Keep the two in sync.
 *
 * Note what this cannot do: a mobile money transaction ID is issued by MTN /
 * Orange, so nothing here can prove an ID is real -- that is the admin's job
 * against the business MoMo statement.
 */

export interface ValidationResult {
  ok: boolean;
  /** Normalised value when ok, otherwise the empty string. */
  value: string;
  error?: string;
}

const BAD_ID = 'That transaction ID looks invalid. Copy it exactly from your confirmation message.';

export function validateTransactionId(
  raw: string,
  ownReference: string = '',
  senderPhone: string = ''
): ValidationResult {
  const v = (raw || '').replace(/\s+/g, '').toUpperCase();
  const fail = (error: string): ValidationResult => ({ ok: false, value: '', error });

  if (!v) return fail('Enter the transaction ID from your mobile money confirmation message.');
  if (!/^[A-Z0-9][A-Z0-9.-]{6,23}[A-Z0-9]$/.test(v)) {
    return fail('That does not look like a mobile money transaction ID. Copy it exactly from your confirmation message (8-25 letters or numbers).');
  }
  if (ownReference && ownReference.toUpperCase().includes(v)) {
    return fail('That is our payment reference, not the transaction ID. The transaction ID comes from your MTN / Orange confirmation message.');
  }
  const alnum = v.replace(/[^A-Z0-9]/g, '');
  if (new Set(alnum).size < 4) return fail(BAD_ID);
  if (/^[0-9]+$/.test(alnum) && ('01234567890123456789'.includes(alnum) || '98765432109876543210'.includes(alnum))) {
    return fail(BAD_ID);
  }
  const phoneDigits = (senderPhone || '').replace(/[^0-9]/g, '');
  if (phoneDigits.length >= 7 && alnum === phoneDigits) return fail('That is a phone number, not a transaction ID.');
  return { ok: true, value: v };
}

export function validateSenderPhone(raw: string): ValidationResult {
  const s = (raw || '').replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(s)) {
    return { ok: false, value: '', error: 'Enter the phone number you paid from, for example 0770000000 or +231770000000.' };
  }
  return { ok: true, value: s };
}
