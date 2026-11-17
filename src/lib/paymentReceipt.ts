/**
 * PDF payment receipts for APPROVED payments only.
 *
 * A receipt states what LibRise recorded: an administrator verified the mobile money transfer and approved the
 * payment. It is generated in the browser from data the signed-in user is already allowed to read (row-level
 * security limits payments to the paying organization and platform admins); nothing is stored or sent anywhere.
 * It is a payment receipt, not a tax invoice, and says so. Text is kept to plain Latin characters because the
 * built-in PDF fonts cannot render anything else.
 */
import type { Payment } from '../types';
import { formatMinorAmount } from '../services/paymentService';
import { APP_METADATA } from '../config/constants';

export interface ReceiptInput {
  payment: Payment;
  planName?: string | null;
  planType?: 'vacancy' | 'subscription' | 'listing' | null;
  organizationName?: string | null;
  /** Vacancy or listing title the payment was for, when there is one. */
  targetTitle?: string | null;
}

export interface ReceiptModel {
  receiptNumber: string;
  title: string;
  rows: Array<[label: string, value: string]>;
  amountLine: string;
  currency: string;
}

const NETWORK: Record<string, string> = {
  manual_momo_mtn: 'MTN Mobile Money',
  manual_momo_orange: 'Orange Money'
};

/** Keep only characters the built-in PDF fonts can draw. */
export const pdfSafe = (value: string): string =>
  value.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '?');

/** Show only the last 4 digits of the sender number. */
export const maskPhone = (phone: string | null | undefined): string => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `****${digits.slice(-4)}` : 'Not provided';
};

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

/** Throws unless the payment was approved: an unverified payment must never get a receipt. */
export function buildReceiptModel(input: ReceiptInput): ReceiptModel {
  const { payment } = input;
  if (payment.status !== 'payment_success') {
    throw new Error('A receipt is only available for approved payments.');
  }
  const kind = input.planType === 'subscription' ? 'Subscription' : input.planType === 'listing' ? 'Business listing promotion' : 'Vacancy';
  const rows: Array<[string, string]> = [
    ['Receipt number', payment.publicPaymentId],
    ['Date paid', formatDate(payment.paidAt ?? payment.reviewedAt)],
    ['Organization', input.organizationName || payment.organizationId],
    ['Item', `${kind}: ${input.planName || payment.description || 'LibRise package'}`]
  ];
  if (input.targetTitle) rows.push(['For', input.targetTitle]);
  rows.push(
    ['Currency', payment.currency],
    ['Paid with', NETWORK[payment.paymentProvider] ?? payment.paymentProvider],
    ['Sender number', maskPhone(payment.senderPhoneNumber)],
    ['Transaction ID', payment.providerTransactionId || '-'],
    ['LibRise reference', payment.providerReference],
    ['Status', 'Verified and approved by LibRise']
  );
  return {
    receiptNumber: payment.publicPaymentId,
    title: 'Payment Receipt',
    rows: rows.map(([k, v]) => [pdfSafe(k), pdfSafe(v)]),
    amountLine: pdfSafe(
      (() => {
        const text = formatMinorAmount(payment.amountMinor, payment.currency);
        return text.includes(payment.currency) ? text : `${text} ${payment.currency}`; // never an amount without its currency
      })()
    ),
    currency: payment.currency
  };
}

export const receiptFileName = (payment: Pick<Payment, 'publicPaymentId' | 'currency'>): string =>
  `LibRise-receipt-${payment.publicPaymentId}-${payment.currency}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

/** Renders the receipt as a PDF Blob. jsPDF is loaded on demand so it never weighs down the main bundle. */
export async function generateReceiptPdf(input: ReceiptInput): Promise<Blob> {
  const model = buildReceiptModel(input);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 20;
  const right = 190;
  let y = 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(40, 54, 24);
  doc.text(APP_METADATA.name, left, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(pdfSafe(APP_METADATA.tagline), left, y + 6);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(19, 42, 19);
  doc.text(model.title, right, y, { align: 'right' });

  y += 16;
  doc.setDrawColor(200, 196, 180);
  doc.line(left, y, right, y);

  y += 12;
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text('AMOUNT PAID', left, y);
  y += 9;
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(19, 42, 19);
  doc.text(model.amountLine, left, y);

  y += 12;
  doc.setFontSize(10);
  for (const [label, value] of model.rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110, 110, 110);
    doc.text(label, left, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(value, right - left - 50) as string[];
    doc.text(lines, left + 50, y);
    y += 7 * Math.max(1, lines.length);
  }

  y += 6;
  doc.line(left, y, right, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  const note = doc.splitTextToSize(
    'This receipt confirms that LibRise verified the mobile money transfer above against its records and approved the payment. ' +
      'It is a payment receipt, not a tax invoice. Keep your mobile money confirmation message as your own proof of payment. ' +
      `Questions: ${APP_METADATA.supportEmail}`,
    right - left
  ) as string[];
  doc.text(note, left, y);

  return doc.output('blob');
}
