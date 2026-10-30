import React, { useState, useMemo, useEffect } from 'react';
import { PaymentReviewHistory } from '../payments/PaymentReviewHistory';
import { PaymentReviewQueue } from '../payments/PaymentReviewQueue';
import {
  ShieldCheck,
  ShieldAlert,
  FileCheck,
  AlertTriangle,
  Building2,
  Briefcase,
  Search,
  Lock,
  Activity,
  History,
  Users,
  CreditCard,
  Grid,
  Settings,
  DollarSign,
  RefreshCw,
  Sliders,
  Globe,
} from 'lucide-react';
import {
  AccountRestriction,
  ContentReport,
  VerificationRequest,
  User,
  Organization,
  Opportunity,
  AuditLog,
  BusinessListing,
  SystemRole,
} from '../../types';
import { db } from '../../db/dbClient';
import { trustSafetyService } from '../../services/trustSafetyService';
import { DocumentList } from '../common/DocumentList';
import { AnalyticsPanel } from './admin/AnalyticsPanel';
import { OpportunityModerationPanel } from './admin/OpportunityModerationPanel';
import { RevenueLedgerPanel } from './admin/RevenueLedgerPanel';
import { SubscriptionsPanel } from './admin/SubscriptionsPanel';
import { AnnouncementPanel, ExchangeRatePanel, IndustriesPanel } from './admin/PlatformSettingsPanels';
import { organizationService } from '../../services/organizationService';
import { adminService } from '../../services/adminService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

/** Loading / error / empty states shared by the admin data tabs. Renders children only when there is data to show. */
const AdminDataState: React.FC<{
  loading: boolean;
  error?: string;
  count: number;
  filteredCount: number;
  emptyText: string;
  noMatchText: string;
  onRetry: () => void;
  children: React.ReactNode;
}> = ({ loading, error, count, filteredCount, emptyText, noMatchText, onRetry, children }) => {
  if (loading && count === 0) return <p className="py-10 text-center text-sm text-stone-500">Loading…</p>;
  if (error) {
    return (
      <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <span>{error}</span>
        <button onClick={onRetry} className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold self-start">Retry</button>
      </div>
    );
  }
  if (count === 0) return <p className="py-10 text-center text-sm text-stone-500">{emptyText}</p>;
  if (filteredCount === 0) return <p className="py-10 text-center text-sm text-stone-500">{noMatchText}</p>;
  return <>{children}</>;
};

type ReportAction = 'warning_issued' | 'listing_quarantined' | 'account_restricted' | 'account_suspended' | 'dismissed';

export const TrustSafetyAdminCenter: React.FC<{ currentUserId?: string }> = () => {
  const { user, login, logout } = useAuth();
  const { showToast } = useToast();

  // Active Admin Sub-tab
  const [adminTab, setAdminTab] = useState<
    | 'analytics'
    | 'users'
    | 'organizations'
    | 'opportunities'
    | 'businesses'
    | 'verification'
    | 'reports'
    | 'subscriptions'
    | 'payments'
    | 'categories'
    | 'content'
    | 'settings'
    | 'audit'
  >('analytics');

  // --- Strict RBAC Authorization Check ---
  const hasAccess = useMemo(() => {
    if (!user) return false;
    return (
      user.systemRole === 'platform_admin' ||
      user.systemRole === 'verifier' ||
      user.systemRole === 'moderator' ||
      user.primaryRole === 'platform_admin'
    );
  }, [user]);

  // Demo Admin Login Helper for quick sandbox testing. Gated on the same
  // build-time-literal check as src/db/dbClient.ts's DEMO_SEED_ENABLED
  // (intentionally NOT envConfig.enableDemoMode -- see that file's comment
  // for why) so esbuild can dead-code-eliminate this entire helper,
  // including the hardcoded demo credentials below, out of any build
  // where VITE_ENABLE_DEMO_MODE isn't literally "true". This must never
  // exist in a real deployment: it is a platform-admin login bypass
  // visible to any unauthenticated visitor who reaches this screen.
  // scripts/check-no-seed-pii-in-bundle.sh is the regression test that
  // verifies this holds in the built output.
  const DEMO_ADMIN_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
  const [isLoggingInDemo, setIsLoggingInDemo] = useState(false);
  const handleDemoAdminLogin = async () => {
    if (!DEMO_ADMIN_LOGIN_ENABLED) return;
    setIsLoggingInDemo(true);
    try {
      await login('info.tracenetlib@gmail.com', 'Champion0041900419');
      showToast('Successfully logged in as Platform Administrator', 'success');
    } catch (err) {
      showToast('Failed to bypass login. Register a platform_admin account.', 'error');
    } finally {
      setIsLoggingInDemo(false);
    }
  };

  // --- Dynamic State loaded directly from our unified DB client ---
  const [users, setUsers] = useState<User[]>(() => (import.meta.env.VITE_ENABLE_DEMO_MODE === 'true' ? db.getUsers() : []));
  // Organizations come from Supabase (the system of record). The local demo dataset is only used when demo
  // mode is explicitly enabled; in production it is empty, which is why this tab used to show no rows.
  const DEMO_DATA_ENABLED = import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
  const [organizations, setOrganizations] = useState<Organization[]>(() => (DEMO_DATA_ENABLED ? db.getOrganizations() : []));
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [orgsError, setOrgsError] = useState('');
  const [orgActionId, setOrgActionId] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => (import.meta.env.VITE_ENABLE_DEMO_MODE === 'true' ? db.getOpportunities() : []));
  const [businesses, setBusinesses] = useState<BusinessListing[]>(() => (import.meta.env.VITE_ENABLE_DEMO_MODE === 'true' ? db.getBusinesses() : []));
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [restrictions, setRestrictions] = useState<AccountRestriction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => (import.meta.env.VITE_ENABLE_DEMO_MODE === 'true' ? db.getAuditLogs() : []));
  const [sectionState, setSectionState] = useState<Record<string, { loading: boolean; error: string }>>({
    users: { loading: true, error: '' },
    opportunities: { loading: true, error: '' },
    businesses: { loading: true, error: '' },
    audit: { loading: true, error: '' }
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  // --- Verification review dialog (decision + reviewer notes) ---
  const [reviewTarget, setReviewTarget] = useState<{ req: VerificationRequest; decision: 'verified' | 'rejected' } | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  // --- Search / Filters for Tables ---
  const [userQuery, setUserQuery] = useState('');
  const [orgQuery, setOrgQuery] = useState('');
  const [bizQuery, setBizQuery] = useState('');
  const [auditQuery, setAuditQuery] = useState('');

  // Form states for adding taxonomy

  // Refresh helper. Verification requests / content reports / account
  // restrictions now come from Supabase via trustSafetyService (Phase 3,
  // Service 8 -- see docs/PHASE3_SERVICE8_VERIFICATION.md); everything
  // else here is still dbClient.ts-backed (opportunities/organizations/
  // businesses/users/anomalies/audit logs are later or already-migrated
  // services this admin dashboard doesn't yet read through their real
  // services either -- a pre-existing gap, not introduced by this pass).
  const loadOrganizations = async () => {
    setOrgsLoading(true);
    setOrgsError('');
    try {
      setOrganizations(await organizationService.getAllOrganizationsForAdmin());
    } catch (err) {
      if (DEMO_DATA_ENABLED) {
        setOrganizations(db.getOrganizations());
      } else {
        setOrgsError(err instanceof Error ? err.message : 'Could not load organizations.');
      }
    } finally {
      setOrgsLoading(false);
    }
  };

  // Loads one admin section from Supabase. Failures show in that tab (with Retry) instead of an empty table;
  // the local demo dataset is only a fallback when demo mode is explicitly enabled.
  const loadSection = async <T,>(key: string, fetcher: () => Promise<T[]>, apply: (rows: T[]) => void, demoRows: () => T[]) => {
    setSectionState((prev) => ({ ...prev, [key]: { loading: true, error: '' } }));
    try {
      apply(await fetcher());
      setSectionState((prev) => ({ ...prev, [key]: { loading: false, error: '' } }));
    } catch (err) {
      if (DEMO_DATA_ENABLED) {
        apply(demoRows());
        setSectionState((prev) => ({ ...prev, [key]: { loading: false, error: '' } }));
      } else {
        setSectionState((prev) => ({
          ...prev,
          [key]: { loading: false, error: err instanceof Error ? err.message : 'Could not load this section.' }
        }));
      }
    }
  };

  const loadUsers = () => loadSection('users', () => adminService.listUsers(), setUsers, () => db.getUsers());
  const loadOpportunities = () => loadSection('opportunities', () => adminService.listOpportunities(), setOpportunities, () => db.getOpportunities());
  const loadBusinesses = () => loadSection('businesses', () => adminService.listBusinessListings(), setBusinesses, () => db.getBusinesses());
  const loadAudit = () => loadSection('audit', () => adminService.listAuditLogs(300), setAuditLogs, () => db.getAuditLogs());

  const refreshAllData = async (silent = false) => {
    const sectionLoads = Promise.all([
      loadOrganizations(),
      loadUsers(),
      loadOpportunities(),
      loadBusinesses(),
      loadAudit()
    ]);
    try {
      const [freshRequests, freshReports, freshRestrictions] = await Promise.all([
        trustSafetyService.getVerificationRequests(),
        trustSafetyService.getContentReports(),
        trustSafetyService.getAccountRestrictions()
      ]);
      setVerificationRequests(freshRequests);
      setReports(freshReports);
      setRestrictions(freshRestrictions);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to sync trust & safety data.', 'error');
    }
    await sectionLoads;
    if (!silent) {
      showToast('Platform databases synced successfully.', 'success');
    }
  };

  useEffect(() => {
    refreshAllData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- ACTIONS ---

  // 1. User account status. Suspension goes through the restriction workflow so the Auth account is
  // banned as well as database access being blocked; reactivation lifts the active full suspensions.
  const toggleUserStatus = async (targetUser: User) => {
    if (busyId) return;
    if (targetUser.id === user?.id) {
      showToast('You cannot suspend your own account.', 'error');
      return;
    }
    setBusyId(targetUser.id);
    try {
      if (targetUser.accountStatus === 'active') {
        if (!window.confirm(`Suspend ${targetUser.fullName}? They will be signed out and blocked until reactivated.`)) return;
        await trustSafetyService.applyAccountRestriction({
          userId: targetUser.id,
          restrictionType: 'full_suspension',
          reason: 'Suspended by platform administrator for investigation'
        });
        showToast(`${targetUser.fullName} has been suspended`, 'success');
      } else {
        const active = restrictions.filter(
          (r) => r.userId === targetUser.id && r.restrictionType === 'full_suspension' && (r.status === 'active' || r.status === 'appealed')
        );
        if (active.length === 0) {
          showToast('This account is not under an active suspension restriction, so it cannot be reactivated from here.', 'error');
          return;
        }
        for (const r of active) await trustSafetyService.liftAccountRestriction(r.id);
        showToast(`${targetUser.fullName} has been reactivated`, 'success');
      }
      await refreshAllData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update user status', 'error');
      await refreshAllData(true);
    } finally {
      setBusyId(null);
    }
  };

  // 1b. Assign User Role
  const changeUserSystemRole = async (target: User, nextRole: SystemRole) => {
    if (busyId || nextRole === target.systemRole) return;
    setBusyId(target.id);
    try {
      await adminService.setUserSystemRole(target.id, nextRole);
      showToast(`${target.fullName} is now ${nextRole.replace(/_/g, ' ')}`, 'success');
      await Promise.all([loadUsers(), loadAudit()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to change user role', 'error');
      await loadUsers(); // snap the dropdown back to the stored value
    } finally {
      setBusyId(null);
    }
  };

  // 2. Organization verification
  const toggleOrganizationVerification = async (org: Organization) => {
    if (orgActionId) return;
    setOrgActionId(org.id);
    try {
      if (org.isVerified) {
        if (!window.confirm(`Revoke verification for ${org.name}? Their badge will be removed immediately.`)) return;
        await organizationService.revokeVerification(org.id, 'Verification revoked by platform administrator');
        showToast(`Verification revoked for ${org.name}`, 'success');
      } else {
        // Verification is only granted through the review workflow, never by flipping a flag.
        const pending = verificationRequests.find(
          (r) => r.entityType === 'organization' && r.entityId === org.id && r.status === 'pending_review'
        );
        if (!pending) {
          showToast(`${org.name} has no pending verification request. Ask them to submit their LBR/TIN documents first.`, 'error');
          return;
        }
        await trustSafetyService.reviewVerificationRequest(pending.id, 'verified', user?.id, 'Approved from organizations directory');
        showToast(`${org.name} is now verified`, 'success');
      }
      await refreshAllData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update organization verification', 'error');
    } finally {
      setOrgActionId(null);
    }
  };

  // 4. Business listing moderation
  const moderateBusiness = async (bizId: string, nextStatus: 'pending_review' | 'published' | 'rejected' | 'suspended') => {
    if (busyId) return;
    setBusyId(bizId);
    try {
      await adminService.moderateBusiness(bizId, nextStatus);
      showToast(`Business listing status set to ${nextStatus}`, 'success');
      await Promise.all([loadBusinesses(), loadAudit()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to moderate business listing', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // 5. Verification Badge decision: opens a dialog so the reviewer records real notes / a rejection reason.
  const handleVerificationRequestAction = (req: VerificationRequest, decision: 'verified' | 'rejected') => {
    setReviewNotes('');
    setReviewTarget({ req, decision });
  };

  const submitVerificationReview = async () => {
    if (!reviewTarget || reviewBusy) return;
    const { req, decision } = reviewTarget;
    const notes = reviewNotes.trim();
    if (decision === 'rejected' && !notes) return;
    setReviewBusy(true);
    try {
      await trustSafetyService.reviewVerificationRequest(
        req.id,
        decision,
        user?.id || 'admin',
        notes || undefined,
        decision === 'rejected' ? notes : undefined
      );
      await recordAudit('verification.request_decision', 'verification_request', req.id, { decision, entityName: req.entityName, notes: notes || undefined });
      setReviewTarget(null);
      refreshAllData();
      showToast(`Verification request ${decision === 'verified' ? 'approved' : 'rejected'} successfully`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to action verification request', 'error');
    } finally {
      setReviewBusy(false);
    }
  };

  // Writes the staff decision to the server-side audit trail. The decision itself is already saved, so a failure here is
  // reported rather than undone.
  const recordAudit = async (action: 'verification.request_decision' | 'report.resolve', resourceType: string, resourceId: string, details: Record<string, unknown>) => {
    try {
      await adminService.logAction(action, resourceType, resourceId, details);
    } catch {
      showToast('Decision saved, but the audit entry could not be recorded. Please tell a platform administrator.', 'error');
    }
  };

  // 6. Report resolution: the reviewer's own note is required for sanctions and optional for a dismissal.
  const [reportTarget, setReportTarget] = useState<{ id: string; action: ReportAction } | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  const handleReportAction = (reportId: string, action: ReportAction) => {
    setReportNote('');
    setReportTarget({ id: reportId, action });
  };

  const submitReportResolution = async () => {
    if (!reportTarget || reportBusy) return;
    const note = reportNote.trim();
    if (reportTarget.action !== 'dismissed' && note.length < 5) return;
    setReportBusy(true);
    try {
      await trustSafetyService.resolveReport(reportTarget.id, reportTarget.action, user?.id || 'admin', note || 'Dismissed after review.');
      await recordAudit('report.resolve', 'content_report', reportTarget.id, { action: reportTarget.action, note: note || undefined });
      setReportTarget(null);
      refreshAllData();
      showToast(`Report resolved: ${reportTarget.action.replace(/_/g, ' ')}`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve report', 'error');
    } finally {
      setReportBusy(false);
    }
  };

  // --- RENDERING VIEWS ---

  // Access Denied Shield Page
  if (!hasAccess) {
    return (
      <div className="max-w-xl mx-auto my-12 bg-white p-8 md:p-12 rounded-[32px] border border-red-100 shadow-xl text-center space-y-6">
        <div className="mx-auto w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-serif font-extrabold text-[#283618] tracking-tight">
            Administrative Access Restricted
          </h2>
          <p className="text-stone-500 text-sm leading-relaxed">
            The platform command center is restricted to registered **Platform Administrators** and **Trust & Safety Officers** with authorized security credentials.
          </p>
          <p className="text-stone-400 text-xs leading-relaxed">
            Note: an "Organization Account Admin" role (set at sign-up) manages your own company's account and
            listings only -- it's different from platform-wide administrator access, which is granted separately
            and isn't available through self-service sign-up.
          </p>
        </div>

        {DEMO_ADMIN_LOGIN_ENABLED && (
        <div className="bg-[#FEFAE0] p-5 rounded-2xl border border-[#E8E4D9] text-left text-xs space-y-3">
          <span className="font-bold text-[#BC6C25] uppercase tracking-wider block">Developer Sandbox Testing Bypass</span>
          <p className="text-stone-600">
            You are currently browsing as a standard guest. To view, audit, and interact with the **14 administrative modules and custom visualizations**, click the simulation link below to log in as the default Administrator.
          </p>
          <button
            onClick={handleDemoAdminLogin}
            disabled={isLoggingInDemo}
            className="w-full py-2.5 bg-[#283618] hover:bg-[#132A13] text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-55"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{isLoggingInDemo ? 'Simulating Admin Session...' : 'Unlock & Login as Demo Admin'}</span>
          </button>
        </div>
        )}
      </div>
    );
  }

  // Counts shown in the tab badges
  const activeReportsCount = reports.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* 1. ADMIN HUB BRAND BANNER */}
      <div className="bg-[#283618] p-6 sm:p-8 rounded-[32px] text-white shadow-xl flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6 border-b-4 border-[#BC6C25]">
        <div>
          <div className="flex items-center gap-2 text-[#A3B18A] text-xs font-bold uppercase tracking-widest mb-1.5">
            <ShieldCheck className="w-4 h-4 text-[#A3B18A]" />
            <span>Statutory Verification & Trust Desk</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
            Administrative Command Center
          </h2>
          <p className="text-xs sm:text-sm text-[#A3B18A]/90 mt-1 max-w-xl">
            Control platform permissions, review LBR regulatory evidence, analyze marketplace activities, moderate fraudulent postings, configure system settings, and inspect immutable audit logs.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshAllData()}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/10 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync DB Status</span>
          </button>
          <button
            onClick={logout}
            className="px-4 py-2 bg-[#BC6C25] hover:bg-[#A35C1D] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Sign Out Admin</span>
          </button>
        </div>
      </div>

      {/* 2. ADMINISTRATIVE SLIDER NAVIGATION (13 TABS) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none border-b border-[#E8E4D9]">
        {[
          { id: 'analytics', label: 'Analytics & Health', icon: Activity },
          { id: 'users', label: 'User Roles & Management', icon: Users },
          { id: 'organizations', label: 'Organizations', icon: Building2 },
          { id: 'opportunities', label: 'Job Moderation', icon: Briefcase },
          { id: 'businesses', label: 'Business Listings', icon: Sliders },
          { id: 'verification', label: 'Verification Queue', icon: FileCheck },
          { id: 'reports', label: `Reports Desk (${activeReportsCount})`, icon: AlertTriangle, badge: true },
          { id: 'subscriptions', label: 'SaaS Subscriptions', icon: CreditCard },
          { id: 'payments', label: 'Revenue Payments', icon: DollarSign },
          { id: 'categories', label: 'Industries', icon: Grid },
          { id: 'content', label: 'Announcements', icon: Globe },
          { id: 'settings', label: 'Platform Config', icon: Settings },
          { id: 'audit', label: 'Audit Log Trail', icon: History }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = adminTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setAdminTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                isActive
                  ? 'bg-[#283618] text-white shadow-md'
                  : 'bg-white text-[#606C38] hover:bg-[#F9F8F4] border border-[#E8E4D9]'
              }`}
            >
              <Icon className={`w-4 h-4 ${tab.badge && activeReportsCount > 0 ? 'text-red-500' : ''}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. SUB-TAB VIEWPORT PORTAL */}
      <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-[#E8E4D9] shadow-xs">
        
        {/* VIEW 1: PLATFORM HEALTH & MARKETPLACE ANALYTICS (real data from the database) */}
        {adminTab === 'analytics' && <AnalyticsPanel onOpenTab={setAdminTab} />}

        {/* VIEW 2: USER MANAGEMENT MODULE */}
        {adminTab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-2xl text-[#132A13]">Platform User Accounts Control</h3>
                <p className="text-stone-500 text-sm">Lock/unlock candidate accounts, investigate reports, or update user system access roles.</p>
              </div>
              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search user email or name..."
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]"
                />
              </div>
            </div>

            {(() => {
              const q = userQuery.trim().toLowerCase();
              const list = users.filter((u) => !q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
              const st = sectionState.users;
              const statusPill = (u: User) => (
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${u.accountStatus === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {u.accountStatus.replace(/_/g, ' ')}
                </span>
              );
              const roleSelect = (u: User) => (
                <select
                  value={u.systemRole}
                  disabled={busyId !== null}
                  aria-label={`Role for ${u.fullName}`}
                  onChange={(e) => changeUserSystemRole(u, e.target.value as SystemRole)}
                  className="bg-stone-50 border border-stone-200 rounded-lg p-2 font-bold text-stone-700 disabled:opacity-50 max-w-full"
                >
                  <option value="user">User</option>
                            <option value="moderator">Moderator</option>
                            <option value="moderation_officer">Moderation Officer</option>
                            <option value="verifier">Verifier</option>
                            <option value="verification_officer">Verification Officer</option>
                            <option value="finance_admin">Finance Admin</option>
                            <option value="platform_admin">Platform Admin</option>
                </select>
              );
              const statusButton = (u: User) => (
                <button
                  onClick={() => toggleUserStatus(u)}
                  disabled={busyId !== null || u.id === user?.id}
                  className={`px-3 py-2 min-h-10 rounded-xl text-[11px] font-extrabold transition-all cursor-pointer disabled:opacity-40 ${
                    u.accountStatus === 'active' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'
                  }`}
                >
                  {busyId === u.id ? 'Working…' : u.accountStatus === 'active' ? 'Suspend' : 'Activate'}
                </button>
              );
              return (
                <AdminDataState loading={st.loading} error={st.error} count={users.length} filteredCount={list.length}
                  emptyText="No users have registered yet." noMatchText="No users match your search." onRetry={loadUsers}>
                  <p className="text-[11px] text-stone-500 font-semibold">{list.length} of {users.length} users</p>
                  <div className="md:hidden space-y-3">
                    {list.map((u) => (
                      <div key={u.id} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-stone-800 text-sm break-words">{u.fullName}</p>
                            <p className="font-mono text-[11px] text-stone-500 break-all">{u.email}</p>
                            <p className="text-[11px] text-stone-500 mt-0.5">{u.primaryCounty} County</p>
                          </div>
                          {statusPill(u)}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {roleSelect(u)}
                          {statusButton(u)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                          <th className="py-3 px-4">Full Name</th>
                          <th className="py-3 px-4">Email Contact</th>
                          <th className="py-3 px-4">Role Assigned</th>
                          <th className="py-3 px-4">County</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E4D9]">
                        {list.map((u) => (
                          <tr key={u.id} className="hover:bg-stone-50/50">
                            <td className="py-3.5 px-4 font-bold text-stone-800">{u.fullName}</td>
                            <td className="py-3.5 px-4 font-mono text-stone-600">{u.email}</td>
                            <td className="py-3.5 px-4">{roleSelect(u)}</td>
                            <td className="py-3.5 px-4 text-stone-700 whitespace-nowrap">{u.primaryCounty} County</td>
                            <td className="py-3.5 px-4">{statusPill(u)}</td>
                            <td className="py-3.5 px-4 text-right">{statusButton(u)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminDataState>
              );
            })()}
          </div>
        )}

        {/* VIEW 3: ORGANIZATION MANAGEMENT */}
        {adminTab === 'organizations' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-2xl text-[#132A13]">Corporate Organizations Database</h3>
                <p className="text-stone-500 text-sm">Review registered employers, check their verification tax certificates, or revoke verification flags.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search organizations..."
                  value={orgQuery}
                  onChange={(e) => setOrgQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]"
                />
              </div>
            </div>

            {(() => {
              const filteredOrgs = organizations.filter((o) => {
                const q = orgQuery.trim().toLowerCase();
                if (!q) return true;
                return [o.name, o.industry, o.registrationNumber, o.taxIdNumber, o.county].some((v) => (v || '').toLowerCase().includes(q));
              });
              const typeLabel = (t?: string) => (t || '').replace(/_/g, ' ') || 'N/A';
              const badgeLabel = (b?: string) => (b || '').replace(/_/g, ' ') || 'None';
              const actionLabel = (org: Organization) => (orgActionId === org.id ? 'Working…' : org.isVerified ? 'Revoke Badges' : 'Mark Verified');
              const actionClass = (org: Organization) =>
                `px-3 py-2 min-h-10 rounded-xl text-[11px] font-bold border transition-all cursor-pointer disabled:opacity-50 ${
                  org.isVerified
                    ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                    : 'bg-[#ECF3E9] text-[#4F772D] border-[#D9E3D5] hover:bg-[#ECF3E9]/80'
                }`;

              if (orgsLoading && organizations.length === 0) {
                return <p className="py-10 text-center text-sm text-stone-500">Loading organizations…</p>;
              }
              if (orgsError) {
                return (
                  <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-800 text-sm flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <span>{orgsError}</span>
                    <button onClick={loadOrganizations} className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold self-start">Retry</button>
                  </div>
                );
              }
              if (filteredOrgs.length === 0) {
                return (
                  <p className="py-10 text-center text-sm text-stone-500">
                    {organizations.length === 0 ? 'No organizations have registered yet.' : 'No organizations match your search.'}
                  </p>
                );
              }

              return (
                <>
                  <p className="text-[11px] text-stone-500 font-semibold">
                    {filteredOrgs.length} of {organizations.length} organizations
                  </p>

                  {/* Phones: one card per organization, nothing to scroll sideways */}
                  <div className="md:hidden space-y-3">
                    {filteredOrgs.map((org) => (
                      <div key={org.id} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[#283618] text-sm break-words">{org.name}</p>
                            <p className="text-xs text-stone-500">{org.industry || 'No industry'} · <span className="capitalize">{typeLabel(org.type)}</span></p>
                          </div>
                          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${org.isVerified ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-600'}`}>
                            {org.isVerified ? 'Verified' : 'Unverified'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-stone-600">
                          <div><span className="block text-[9px] uppercase tracking-wider text-stone-400 font-sans font-bold">LBR No</span>{org.registrationNumber || 'N/A'}</div>
                          <div><span className="block text-[9px] uppercase tracking-wider text-stone-400 font-sans font-bold">TIN</span>{org.taxIdNumber || 'N/A'}</div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-[10px] font-bold uppercase">{badgeLabel(org.verificationBadge)}</span>
                          <button onClick={() => toggleOrganizationVerification(org)} disabled={orgActionId !== null} className={actionClass(org)}>
                            {actionLabel(org)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tablets / desktop: full table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                          <th className="py-3 px-4">Org Name</th>
                          <th className="py-3 px-4">Industry Sector</th>
                          <th className="py-3 px-4">Type</th>
                          <th className="py-3 px-4">LBR No &amp; TIN</th>
                          <th className="py-3 px-4">Badge</th>
                          <th className="py-3 px-4">Is Verified</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E4D9]">
                        {filteredOrgs.map((org) => (
                          <tr key={org.id} className="hover:bg-stone-50/50">
                            <td className="py-3.5 px-4 font-bold text-[#283618]">{org.name}</td>
                            <td className="py-3.5 px-4 text-stone-600">{org.industry}</td>
                            <td className="py-3.5 px-4 font-semibold capitalize text-stone-700">{typeLabel(org.type)}</td>
                            <td className="py-3.5 px-4 font-mono text-stone-500 whitespace-nowrap">
                              <div>LBR: {org.registrationNumber || 'N/A'}</div>
                              <div>TIN: {org.taxIdNumber || 'N/A'}</div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap">{badgeLabel(org.verificationBadge)}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${org.isVerified ? 'bg-green-100 text-green-800' : 'bg-stone-100 text-stone-600'}`}>
                                {org.isVerified ? 'Verified' : 'Unverified'}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button onClick={() => toggleOrganizationVerification(org)} disabled={orgActionId !== null} className={actionClass(org)}>
                                {actionLabel(org)}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* VIEW 4: OPPORTUNITY & JOB MODERATION */}
        {adminTab === 'opportunities' && (
          <OpportunityModerationPanel
            opportunities={opportunities}
            organizations={organizations}
            loading={sectionState.opportunities.loading}
            error={sectionState.opportunities.error}
            onChanged={async () => {
              await Promise.all([loadOpportunities(), loadAudit()]);
            }}
            onRetry={loadOpportunities}
          />
        )}

        {/* VIEW 5: BUSINESS LISTING MODERATION */}
        {adminTab === 'businesses' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-2xl text-[#132A13]">Business Marketplace Sales Moderation</h3>
                <p className="text-stone-500 text-sm">Review confidential listings, asking price parameters, and verified M&A declarations.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Search listings..."
                  value={bizQuery}
                  onChange={(e) => setBizQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]"
                />
              </div>
            </div>

            {(() => {
              const q = bizQuery.trim().toLowerCase();
              const list = businesses.filter((b) => !q || b.title.toLowerCase().includes(q) || (b.industry || '').toLowerCase().includes(q));
              const st = sectionState.businesses;
              const price = (b: BusinessListing) => (typeof b.askingPriceUSD === 'number' ? `$${b.askingPriceUSD.toLocaleString()} USD` : 'Price on request');
              const pill = (b: BusinessListing) => (
                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap ${
                  (b.moderationStatus || 'published') === 'published' ? 'bg-green-100 text-green-800'
                    : b.moderationStatus === 'suspended' || b.moderationStatus === 'rejected' ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {(b.moderationStatus || 'published').replace(/_/g, ' ')}
                </span>
              );
              const actions = (b: BusinessListing) => (
                <div className="flex gap-2">
                  <button onClick={() => moderateBusiness(b.id, 'published')} disabled={busyId !== null || b.moderationStatus === 'published'}
                    className="px-3 py-2 min-h-10 bg-green-50 text-green-700 rounded-lg font-bold border border-green-200 hover:bg-green-100 transition-all cursor-pointer disabled:opacity-40">
                    Approve
                  </button>
                  <button onClick={() => moderateBusiness(b.id, 'suspended')} disabled={busyId !== null || b.moderationStatus === 'suspended'}
                    className="px-3 py-2 min-h-10 bg-red-50 text-red-700 rounded-lg font-bold border border-red-200 hover:bg-red-100 transition-all cursor-pointer disabled:opacity-40">
                    Suspend
                  </button>
                </div>
              );
              return (
                <AdminDataState loading={st.loading} error={st.error} count={businesses.length} filteredCount={list.length}
                  emptyText="No business listings have been submitted yet." noMatchText="No listings match your search." onRetry={loadBusinesses}>
                  <p className="text-[11px] text-stone-500 font-semibold">{list.length} of {businesses.length} listings</p>
                  <div className="md:hidden space-y-3">
                    {list.map((b) => (
                      <div key={b.id} className="rounded-2xl border border-[#E8E4D9] bg-white p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[#283618] text-sm break-words">{b.title}</p>
                            <p className="text-xs text-stone-600">{b.industry} · {b.county} County</p>
                            <p className="text-xs font-bold text-[#BC6C25] mt-0.5">{price(b)}</p>
                          </div>
                          {pill(b)}
                        </div>
                        {actions(b)}
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E8E4D9] bg-[#F9F8F6] text-stone-500 uppercase tracking-wider font-bold whitespace-nowrap">
                          <th className="py-3 px-4">Listing Title</th>
                          <th className="py-3 px-4">Industry</th>
                          <th className="py-3 px-4">Asking Price</th>
                          <th className="py-3 px-4">County</th>
                          <th className="py-3 px-4">Moderation Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E4D9]">
                        {list.map((b) => (
                          <tr key={b.id} className="hover:bg-stone-50/50">
                            <td className="py-3.5 px-4 font-bold text-[#283618]">{b.title}</td>
                            <td className="py-3.5 px-4 text-stone-600">{b.industry}</td>
                            <td className="py-3.5 px-4 font-bold text-[#BC6C25] whitespace-nowrap">{price(b)}</td>
                            <td className="py-3.5 px-4 text-stone-500 whitespace-nowrap">{b.county} County</td>
                            <td className="py-3.5 px-4">{pill(b)}</td>
                            <td className="py-3.5 px-4 text-right">{actions(b)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AdminDataState>
              );
            })()}
          </div>
        )}

        {/* VIEW 6: STATUTORY EVIDENCE QUEUE */}
        {adminTab === 'verification' && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="font-serif font-bold text-2xl text-[#132A13]">Statutory Evidence Review Queue</h3>
              <p className="text-stone-500 text-sm">Review government business permits, articles of incorporation, and tax clearance certificates.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {verificationRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-white p-6 rounded-3xl border border-[#E8E4D9] shadow-xs space-y-4"
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-stone-100 pb-3">
                    <div>
                      <span className="font-extrabold text-lg text-[#283618] block">{req.entityName}</span>
                      <span className="text-xs text-stone-400 font-mono">Request Reference: {req.id}</span>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      req.status === 'verified'
                        ? 'bg-[#ECF3E9] text-[#4F772D]'
                        : req.status === 'rejected'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}>
                      {req.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase block">LBR Certificate No</span>
                      <span className="font-mono font-bold text-[#132A13]">{req.registrationNumber || 'Pending'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase block">LRA Tax ID (TIN)</span>
                      <span className="font-mono font-bold text-[#132A13]">{req.taxIdNumber || 'Pending'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase block">County Location</span>
                      <span className="font-semibold text-stone-700">{req.county} County</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-stone-400 font-bold uppercase block">Badge Claimed</span>
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-800 rounded text-[10px] font-extrabold uppercase">
                        {req.badgeRequested.replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-stone-700 block">Attached Proof Dossier Files:</span>
                    <DocumentList
                      compact
                      documents={(req.evidenceDocuments || []).map((doc) => ({
                        id: doc.id,
                        fileName: doc.fileName,
                        fileType: doc.fileType,
                        fileSize: doc.fileSize,
                        path: doc.path,
                        label: (doc.documentType || 'other').replace(/_/g, ' ')
                      }))}
                      resolveUrls={(docs) => trustSafetyService.getEvidenceUrls(docs)}
                      emptyText="The applicant did not attach any documents."
                      unavailableText="File not stored (submitted before uploads were supported)"
                    />
                    {req.evidenceNotes && (
                      <p className="text-xs text-stone-600 bg-[#F9F8F6] border border-[#E8E4D9] rounded-xl p-3">
                        <strong>Applicant notes:</strong> {req.evidenceNotes}
                      </p>
                    )}
                  </div>

                  {req.status === 'pending_review' && (
                    <div className="flex gap-2 pt-2 border-t border-stone-100">
                      <button
                        onClick={() => handleVerificationRequestAction(req, 'verified')}
                        className="px-4 py-2 bg-[#ECF3E9] text-[#4F772D] border border-[#D9E3D5] text-xs font-extrabold rounded-xl hover:bg-[#ECF3E9]/80 transition-all cursor-pointer"
                      >
                        Approve statutory badge
                      </button>
                      <button
                        onClick={() => handleVerificationRequestAction(req, 'rejected')}
                        className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-xs font-extrabold rounded-xl hover:bg-red-100 transition-all cursor-pointer"
                      >
                        Reject proof dossier
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 7: COMMUNITY REPORTS & SCAM DESK */}
        {adminTab === 'reports' && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="font-serif font-bold text-2xl text-[#132A13]">Scam & Violation Investigative Desk</h3>
              <p className="text-stone-500 text-sm">Review anonymous reports flagging illegal upfront recruitment fees or corporate identity theft.</p>
            </div>

            <div className="space-y-4">
              {reports.map((rep) => (
                <div key={rep.id} className="bg-red-50/20 border border-red-100 p-6 rounded-3xl space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-red-100/30 pb-3">
                    <div>
                      <span className="font-extrabold text-stone-800 text-sm flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        Report reference: {rep.id}
                      </span>
                      <span className="text-xs text-stone-500">Reported entity: <strong>{rep.targetTitleOrName}</strong> ({rep.reportType})</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                      rep.status === 'actioned' || rep.status === 'dismissed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {rep.status}
                    </span>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-red-100/40 text-xs space-y-2 text-stone-700">
                    <div>
                      <strong className="text-stone-800 block">Reason classification:</strong>
                      <span className="uppercase font-bold text-red-700">{rep.reason.replace('_', ' ')}</span>
                    </div>
                    <div>
                      <strong className="text-stone-800 block">Reporter details:</strong>
                      <span>{rep.reporterName} ({rep.reporterEmail})</span>
                    </div>
                    <div>
                      <strong className="text-stone-800 block font-bold mt-1">Written Testimony:</strong>
                      <p className="text-stone-600 bg-stone-50 p-3 rounded-xl border border-stone-200/50 italic mt-1 font-mono">
                        "{rep.details}"
                      </p>
                    </div>
                  </div>

                  {rep.status === 'pending' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => handleReportAction(rep.id, 'listing_quarantined')}
                        className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-bold hover:bg-red-100 transition-all cursor-pointer"
                      >
                        Quarantine Listing
                      </button>
                      <button
                        onClick={() => handleReportAction(rep.id, 'account_restricted')}
                        className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold hover:bg-amber-100 transition-all cursor-pointer"
                      >
                        Restrict Account
                      </button>
                      <button
                        onClick={() => handleReportAction(rep.id, 'dismissed')}
                        className="px-3 py-1.5 bg-stone-50 text-stone-600 border border-stone-200 rounded-xl text-xs font-bold hover:bg-stone-100 transition-all cursor-pointer"
                      >
                        Dismiss Report
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 8: SAAS SUBSCRIPTIONS ENTITLEMENTS */}
        {adminTab === 'subscriptions' && <SubscriptionsPanel />}

        {/* VIEW 9: PAYMENTS LEDGER LOGS */}
        {adminTab === 'payments' && (
          <div className="space-y-6">
            {/* REAL: manual mobile money payments awaiting admin confirmation. */}
            <PaymentReviewQueue />
            <PaymentReviewHistory />

            <hr className="border-[#E8E4D9]" />

            <RevenueLedgerPanel />
          </div>
        )}

        {/* VIEWS 10-12: industries, announcement and exchange rate: real, saved to the database and used by the app */}
        {adminTab === 'categories' && <IndustriesPanel />}
        {adminTab === 'content' && <AnnouncementPanel />}
        {adminTab === 'settings' && <ExchangeRatePanel />}

        {/* VIEW 13: IMMUTABLE AUDIT TRAIL LOG */}
        {adminTab === 'audit' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <h3 className="font-serif font-bold text-2xl text-[#132A13]">Platform Immutable Log Trail</h3>
                <p className="text-stone-500 text-sm">Chronological registry of administrative triggers, modifications, and system interventions.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                <input
                  type="text"
                  placeholder="Filter audit actions..."
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-[#E8E4D9] focus:outline-none focus:border-[#283618] bg-[#F9F8F6]"
                />
              </div>
            </div>

            {(() => {
              const q = auditQuery.trim().toLowerCase();
              const list = auditLogs.filter((log) => !q || log.action.toLowerCase().includes(q) || (log.actorName || '').toLowerCase().includes(q) || (log.targetEntity || '').toLowerCase().includes(q));
              const st = sectionState.audit;
              return (
                <AdminDataState loading={st.loading} error={st.error} count={auditLogs.length} filteredCount={list.length}
                  emptyText="No administrative activity has been recorded yet." noMatchText="No log entries match your filter." onRetry={loadAudit}>
                  <div className="space-y-3 font-mono text-xs">
                    {list.map((log) => (
                      <div key={log.id} className="p-4 bg-[#F9F8F6] border border-[#E8E4D9] rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-[11px] leading-relaxed">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-[#132A13]">{log.actorName || 'Platform Process'}</span>
                            <span className="px-1.5 py-0.5 bg-[#ECF3E9] border border-[#D9E3D5] text-[#4F772D] rounded text-[10px] uppercase font-bold">{log.action}</span>
                          </div>
                          <p className="text-stone-600 break-words">
                            {log.targetEntity}{log.targetId ? ` · ${log.targetId}` : ''}
                            {log.details && Object.keys(log.details).length > 0
                              ? ' — ' + Object.entries(log.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')
                              : ''}
                          </p>
                        </div>
                        <div className="text-stone-400 shrink-0 sm:text-right text-[10px]">
                          <div className="break-all">ID: {log.id}</div>
                          <div>{new Date(log.createdAt).toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </AdminDataState>
              );
            })()}
          </div>
        )}

      </div>

      {/* Document Review & Preview Modal */}
      {reportTarget && (
        <div role="dialog" aria-modal="true" aria-label="Resolve report" className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6 overflow-hidden overscroll-contain">
          <div className="bg-white w-full max-w-lg rounded-3xl border border-[#E8E4D9] shadow-2xl p-5 sm:p-6 space-y-4 max-h-[92dvh] overflow-y-auto overscroll-contain">
            <div>
              <h3 className="font-serif font-bold text-lg text-[#132A13]">Resolve report: {reportTarget.action.replace(/_/g, ' ')}</h3>
              <p className="text-xs text-stone-500 mt-1">This action is applied immediately and recorded in the audit trail.</p>
            </div>
            <div>
              <label htmlFor="report-note" className="block text-xs font-bold text-[#283618] mb-1">
                {reportTarget.action === 'dismissed' ? 'Note (optional)' : 'Resolution note *'}
              </label>
              <textarea id="report-note" rows={3} maxLength={500} value={reportNote} onChange={(e) => setReportNote(e.target.value)}
                placeholder="What did you find, and why is this the right action?"
                className="w-full p-3 text-sm bg-[#F9F8F6] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D] resize-none" />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" disabled={reportBusy} onClick={() => setReportTarget(null)} className="min-h-11 px-4 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer">Cancel</button>
              <button type="button" disabled={reportBusy || (reportTarget.action !== 'dismissed' && reportNote.trim().length < 5)} onClick={submitReportResolution}
                className="min-h-11 px-5 text-xs font-bold text-white rounded-xl bg-[#283618] hover:bg-[#132A13] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                {reportBusy ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Verification decision"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-hidden overscroll-contain"
        >
          <div className="bg-white w-full max-w-lg rounded-3xl border border-[#E8E4D9] shadow-2xl p-6 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div>
              <h3 className="font-serif font-bold text-lg text-[#132A13]">
                {reviewTarget.decision === 'verified' ? 'Approve verification' : 'Reject verification'}
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">{reviewTarget.req.entityName}</p>
            </div>
            <div>
              <label htmlFor="review-notes" className="block text-xs font-bold text-[#283618] mb-1">
                {reviewTarget.decision === 'verified' ? 'Reviewer notes (optional)' : 'Reason for rejection *'}
              </label>
              <textarea
                id="review-notes"
                rows={4}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder={
                  reviewTarget.decision === 'verified'
                    ? 'e.g. LBR certificate and TIN match the registry.'
                    : 'Tell the applicant what is missing or does not match so they can resubmit.'
                }
                className="w-full p-3 text-sm bg-[#F9F8F4] rounded-xl border border-[#E8E4D9] outline-none focus:border-[#4F772D] resize-none"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={reviewBusy}
                onClick={() => setReviewTarget(null)}
                className="min-h-11 px-4 text-xs font-bold text-stone-600 hover:bg-stone-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reviewBusy || (reviewTarget.decision === 'rejected' && !reviewNotes.trim())}
                onClick={submitVerificationReview}
                className={`min-h-11 px-5 text-xs font-bold text-white rounded-xl cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  reviewTarget.decision === 'verified' ? 'bg-[#4F772D] hover:bg-[#283618]' : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {reviewBusy ? 'Saving…' : reviewTarget.decision === 'verified' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
