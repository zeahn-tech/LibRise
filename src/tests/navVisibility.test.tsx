/**
 * Renders the REAL Navbar and MobileBottomNav (static HTML, contexts mocked)
 * for each kind of account and asserts what is actually in the markup -- the
 * proof that a job seeker never gets a Post button, etc.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthorizationContext } from '../core/auth/permissionEngine';
import type { OrgRole, SystemRole, User, UserCapability, UserRole } from '../types';

let currentCtx: AuthorizationContext;

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: currentCtx.user,
    activeOrganization: currentCtx.activeOrganization,
    authContext: currentCtx,
    switchRole: vi.fn(),
    openAuthModal: vi.fn(),
    logout: vi.fn()
  })
}));
vi.mock('../context/ConfigContext', () => ({
  useConfig: () => ({ isLowBandwidthMode: false, toggleLowBandwidthMode: vi.fn() })
}));
vi.mock('../hooks/useNotifications', () => ({
  useNotifications: () => ({ notifications: [], unreadCount: 0, loading: false, error: null, refresh: vi.fn(), markAsRead: vi.fn(), markAllAsRead: vi.fn() })
}));
vi.mock('../components/auth/UserProfileModal', () => ({ UserProfileModal: () => null }));
vi.mock('../components/notifications/NotificationCenterModal', () => ({ NotificationCenterModal: () => null }));
vi.mock('../components/organization/OrganizationWizardModal', () => ({ OrganizationWizardModal: () => null }));
vi.mock('../components/organization/OrganizationTeamModal', () => ({ OrganizationTeamModal: () => null }));
vi.mock('../components/pwa/PWAInstallButton', () => ({ PWAInstallButton: () => null }));
vi.mock('../components/common/CurrencySwitcher', () => ({ CurrencySwitcher: () => null }));
vi.mock('../components/common/BrandLogo', () => ({ BrandLogo: () => null }));
vi.mock('../components/organization/OrganizationSwitcher', () => ({
  OrganizationSwitcher: () => <div data-testid="org-switcher" />
}));

import { Navbar } from '../components/Navbar';
import { MobileBottomNav } from '../components/MobileBottomNav';

function makeCtx(o: { role?: UserRole; system?: SystemRole; caps?: UserCapability[]; orgRole?: OrgRole; guest?: boolean }): AuthorizationContext {
  if (o.guest) return { user: null, activeOrganization: null, membership: null, capabilities: [], platformRole: 'user', userMemberships: [] };
  const user = { id: 'u1', fullName: 'Test User', email: 't@x.io', primaryRole: o.role ?? 'job_seeker', systemRole: o.system ?? 'user', accountStatus: 'active', capabilities: o.caps ?? [] } as unknown as User;
  const m = o.orgRole ? [{ id: 'm', organizationId: 'org1', userId: 'u1', orgRole: o.orgRole, status: 'active', permissions: [], createdAt: '' }] : [];
  return { user, activeOrganization: o.orgRole ? ({ id: 'org1', name: 'Acme' } as never) : null, membership: (m[0] as never) ?? null, capabilities: o.caps ?? [], platformRole: o.system ?? 'user', userMemberships: m as never };
}

const nav = () =>
  renderToStaticMarkup(
    <Navbar activeTab="opportunities" setActiveTab={() => {}} currency="USD" setCurrency={() => {}} currentRole="job_seeker" setCurrentRole={() => {}} onOpenPostModal={() => {}} notificationCount={0} />
  );
const bottom = () => renderToStaticMarkup(<MobileBottomNav activeTab="opportunities" setActiveTab={() => {}} />);

const POST = ['id="post-opportunity-button"', 'id="post-opportunity-fab"'];

describe('Navbar + mobile nav markup per account type', () => {
  beforeEach(() => {
    currentCtx = makeCtx({ guest: true });
  });

  it('guest: no Post, no workspaces, only Sign In / Create Account', () => {
    currentCtx = makeCtx({ guest: true });
    const html = nav() + bottom();
    POST.forEach((p) => expect(html).not.toContain(p));
    ['Recruiter Studio', 'Candidate Portal', 'Subscriptions', 'Trust &amp; Safety', 'AI Copilot', 'Messages', 'Verification Hub'].forEach((t) => expect(html).not.toContain(t));
    expect(html).toContain('navbar-signin-button');
    expect(html).toContain('All Opportunities');
  });

  it('job seeker / freelancer: Candidate Portal yes; Post, Recruiter, Billing, Admin NO', () => {
    currentCtx = makeCtx({ role: 'job_seeker', caps: ['find_opportunities'] });
    const html = nav() + bottom();
    POST.forEach((p) => expect(html).not.toContain(p));
    expect(html).not.toContain('Recruiter Studio');
    expect(html).not.toContain('Recruiter Workspace');
    expect(html).not.toContain('Subscriptions');
    expect(html).not.toContain('SaaS Subscriptions');
    expect(html).not.toContain('Trust &amp; Safety');
    expect(html).not.toContain('org-switcher');
    expect(html).toContain('Candidate Portal');
    expect(html).toContain('My Career');
    expect(html).toContain('Messages');
    expect(html).toContain('AI Copilot');
  });

  it('employer owner: Post (desktop + mobile), Recruiter, Billing; NO candidate portal / My Career', () => {
    currentCtx = makeCtx({ role: 'employer', caps: ['hire_or_recruit'], orgRole: 'owner' });
    const html = nav() + bottom();
    POST.forEach((p) => expect(html).toContain(p));
    expect(html).toContain('Recruiter Studio');
    expect(html).toContain('Subscriptions');
    expect(html).toContain('org-switcher');
    expect(html).not.toContain('Candidate Portal');
    expect(html).not.toContain('My Career');
    expect(html).not.toContain('Trust &amp; Safety');
  });

  it('recruiter team member: Post + Recruiter, but no Subscriptions', () => {
    currentCtx = makeCtx({ role: 'recruiter', caps: ['hire_or_recruit'], orgRole: 'recruiter' });
    const html = nav() + bottom();
    expect(html).toContain('id="post-opportunity-button"');
    expect(html).toContain('Recruiter Studio');
    expect(html).not.toContain('Subscriptions');
  });

  it('buyer: no Post, no recruiter, no candidate portal', () => {
    currentCtx = makeCtx({ role: 'buyer', caps: ['find_business'] });
    const html = nav() + bottom();
    POST.forEach((p) => expect(html).not.toContain(p));
    expect(html).not.toContain('Recruiter Studio');
    expect(html).not.toContain('Candidate Portal');
    expect(html).toContain('Business M&amp;A');
  });

  it('verification officer: Trust & Safety, nothing employer/candidate', () => {
    currentCtx = makeCtx({ role: 'verification_officer', system: 'verification_officer' });
    const html = nav() + bottom();
    expect(html).toContain('Trust &amp; Safety');
    POST.forEach((p) => expect(html).not.toContain(p));
    expect(html).not.toContain('Candidate Portal');
    expect(html).not.toContain('Subscriptions');
  });

  it('platform admin sees everything', () => {
    currentCtx = makeCtx({ role: 'platform_admin', system: 'platform_admin' });
    const html = nav() + bottom();
    POST.forEach((p) => expect(html).toContain(p));
    ['Recruiter Studio', 'Candidate Portal', 'Subscriptions', 'Trust &amp; Safety'].forEach((t) => expect(html).toContain(t));
  });
});
