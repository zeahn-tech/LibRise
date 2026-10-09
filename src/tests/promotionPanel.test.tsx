/** Renders the REAL PromotionPanel (static HTML) for each plan tier. */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PromotionPanel } from '../components/employer/PromotionPanel';
import { getPlanForSubscription } from '../data/subscriptionPlans';
import type { Opportunity } from '../types';

vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../services/opportunityService', () => ({ opportunityService: { update: vi.fn() } }));

const opp = (id: string, extra: Partial<Opportunity> = {}) =>
  ({ id, title: `Job ${id}`, status: 'published', ...extra }) as Opportunity;

const render = (tier: 'free' | 'basic' | 'pro', opps: Opportunity[]) =>
  renderToStaticMarkup(
    <PromotionPanel
      opportunities={opps}
      entitlements={getPlanForSubscription({ tier }).entitlements}
      onChanged={() => {}}
      onOpenBilling={() => {}}
    />
  );

describe('PromotionPanel', () => {
  it('Free: no promotion controls, just a pointer to pay-as-you-go or Starter', () => {
    const html = render('free', [opp('a')]);
    expect(html).toContain('promotion-teaser');
    expect(html).not.toContain('Feature this job');
    expect(html).toContain('$3');
    expect(html).toContain('$5');
    expect(html).toContain('$10');
  });

  it('Starter: one featured slot, usable on a published job', () => {
    const html = render('basic', [opp('a')]);
    expect(html).toContain('0 of 1 featured slot used');
    expect(html).toContain('Feature this job');
    expect(html).not.toMatch(/disabled=""/);
  });

  it('Starter: with the slot taken, other jobs cannot be featured and the featured one can be removed', () => {
    const html = render('basic', [opp('a', { isFeatured: true }), opp('b')]);
    expect(html).toContain('1 of 1 featured slot used');
    expect(html).toContain('Remove featured');
    expect((html.match(/disabled=""/g) || []).length).toBe(1); // only job b is blocked
  });

  it('Pro: five featured slots', () => {
    expect(render('pro', [opp('a')])).toContain('0 of 5 featured slots used');
  });

  it('a boosted (paid Premium) job cannot be un-featured early', () => {
    const html = render('pro', [opp('a', { isFeatured: true, promotionLevel: 'premium' })]);
    expect(html).toContain('Premium');
    expect(html).toMatch(/disabled=""/);
  });

  it('drafts and closed jobs are never offered for featuring', () => {
    const html = render('pro', [opp('a', { status: 'draft' }), opp('b', { status: 'closed' })]);
    expect(html).toBe('');
  });
});
