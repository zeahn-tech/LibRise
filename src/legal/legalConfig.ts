/**
 * legalConfig.ts
 *
 * The ONLY place that holds the operator-specific facts used by the Privacy Policy, Terms of Service,
 * Refund Policy and Cookie Policy. Edit these (or set the VITE_ variables) and every legal page updates.
 * See docs/LEGAL.md.
 */

import { APP_METADATA } from '../config/constants';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const LEGAL = {
  /** Brand shown to users. */
  productName: APP_METADATA.name,
  /** The legal person that operates LibRise (company name as registered). Set VITE_LEGAL_ENTITY_NAME. */
  operatorName: env.VITE_LEGAL_ENTITY_NAME || APP_METADATA.name,
  /** Optional registered/postal address; shown only when set. Set VITE_LEGAL_ADDRESS. */
  postalAddress: env.VITE_LEGAL_ADDRESS || '',
  /** Where privacy requests, refund requests, appeals and legal notices go. Set VITE_SUPPORT_EMAIL. */
  supportEmail: env.VITE_SUPPORT_EMAIL || APP_METADATA.supportEmail,

  /** Human-readable date and a machine version; bump the version when the meaning of a document changes. */
  lastUpdated: '25 October 2026',
  documentVersion: '2026-10-25',

  /** Minimum age to hold an account. */
  minimumAge: 18,

  /** Commitments we make in the documents. Only keep numbers the business can actually meet. */
  privacyRequestResponseDays: 30,
  refundRequestWindowDays: 14,
  refundDecisionBusinessDays: 7,
  paymentWindowHours: 48,

  /** Law and courts that govern the Terms. */
  governingLaw: 'the Republic of Liberia',
  courts: 'the competent courts of the Republic of Liberia'
} as const;

export type LegalSlug = 'privacy' | 'terms' | 'refunds' | 'cookies';

export const LEGAL_NAV: { slug: LegalSlug; label: string; short: string }[] = [
  { slug: 'privacy', label: 'Privacy Policy', short: 'Privacy' },
  { slug: 'terms', label: 'Terms of Service', short: 'Terms' },
  { slug: 'refunds', label: 'Refund Policy', short: 'Refunds' },
  { slug: 'cookies', label: 'Cookie Policy', short: 'Cookies' }
];

export const legalPath = (slug: LegalSlug) => `/legal/${slug}`;
