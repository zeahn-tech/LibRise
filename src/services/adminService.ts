/**
 * Platform-admin data access for the admin dashboard (TrustSafetyAdminCenter).
 *
 * Everything here goes through SECURITY DEFINER RPCs that verify the caller is a platform admin
 * server-side (see supabase/migrations/20261022110000_admin_dashboard_backend.sql). The browser never
 * gets table-wide access: a non-admin who calls any of these receives a 403 from the database.
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { toDbError } from './dbErrors';
import { ForbiddenError } from '../core/errors/AppError';
import { rowToOpportunity, OpportunityRow } from './opportunityService';
import { rowToListing, BusinessListingRow } from './businessService';
import type {
  AuditLog,
  BusinessListing,
  County,
  Opportunity,
  SuspiciousActivityEvent,
  SystemRole,
  User,
  UserRole,
  AccountStatus
} from '../types';

function client() {
  return getSupabaseClient();
}

function fail(error: { code?: string; message: string }): never {
  if (error.code === '42501') {
    throw new ForbiddenError(error.message || 'You do not have permission to perform this action.');
  }
  throw toDbError('adminService', error);
}

interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  primary_role: string | null;
  system_role: string | null;
  account_status: string | null;
  avatar_url: string | null;
  primary_county: string | null;
  is_email_verified: boolean | null;
  is_phone_verified: boolean | null;
  created_at: string;
  last_login_at: string | null;
}

interface AdminAuditRow {
  id: string;
  user_id: string | null;
  actor_name: string | null;
  organization_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface SuspiciousRow {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  ip_address: string | null;
  event_type: string;
  severity: string;
  description: string;
  status: string;
  created_at: string;
}

export type OpportunityModerationStatus = 'published' | 'pending_review' | 'flagged' | 'quarantined' | 'rejected';
export type BusinessModerationStatus = 'pending_review' | 'published' | 'rejected' | 'suspended';

function rowToUser(r: AdminUserRow): User {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    phoneNumber: r.phone_number ?? undefined,
    primaryRole: (r.primary_role as UserRole) ?? undefined,
    systemRole: ((r.system_role as SystemRole) || 'user') as SystemRole,
    accountStatus: ((r.account_status as AccountStatus) || 'active') as AccountStatus,
    avatarUrl: r.avatar_url ?? undefined,
    primaryCounty: (r.primary_county as County) || ('Montserrado' as County),
    isEmailVerified: !!r.is_email_verified,
    isPhoneVerified: !!r.is_phone_verified,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at ?? undefined,
    // Not stored on public.users; the admin directory does not need them.
    capabilities: [],
    onboardingCompleted: true,
    preferences: {
      emailNotifications: true,
      smsNotifications: false,
      marketingAlerts: true,
      profileVisibility: 'public',
      showPhoneNumber: false
    }
  };
}

export const adminService = {
  async listUsers(): Promise<User[]> {
    const { data, error } = await client().rpc('admin_list_users');
    if (error) fail(error);
    return ((data as AdminUserRow[]) || []).map(rowToUser);
  },

  async setUserSystemRole(userId: string, role: SystemRole): Promise<void> {
    const { error } = await client().rpc('admin_set_user_system_role', { p_user_id: userId, p_role: role });
    if (error) fail(error);
  },

  async listOpportunities(): Promise<Opportunity[]> {
    const { data, error } = await client().rpc('admin_list_opportunities');
    if (error) fail(error);
    return ((data as OpportunityRow[]) || []).map(rowToOpportunity);
  },

  async moderateOpportunity(id: string, status: OpportunityModerationStatus): Promise<void> {
    const { error } = await client().rpc('admin_moderate_opportunity', { p_id: id, p_status: status });
    if (error) fail(error);
  },

  async listBusinessListings(): Promise<BusinessListing[]> {
    const { data, error } = await client().rpc('admin_list_business_listings');
    if (error) fail(error);
    return ((data as BusinessListingRow[]) || []).map(rowToListing);
  },

  async moderateBusiness(id: string, status: BusinessModerationStatus): Promise<void> {
    const { error } = await client().rpc('admin_moderate_business', { p_id: id, p_status: status });
    if (error) fail(error);
  },

  async listAuditLogs(limit = 300): Promise<AuditLog[]> {
    const { data, error } = await client().rpc('admin_list_audit_logs', { p_limit: limit });
    if (error) fail(error);
    return ((data as AdminAuditRow[]) || []).map((r) => ({
      id: r.id,
      actorUserId: r.user_id ?? undefined,
      actorName: r.actor_name ?? undefined,
      organizationId: r.organization_id ?? undefined,
      action: r.action,
      targetEntity: r.resource_type,
      targetId: r.resource_id ?? '',
      details: r.details ?? undefined,
      ipAddress: r.ip_address ?? undefined,
      createdAt: r.created_at
    }));
  },

  async listSuspiciousActivity(): Promise<SuspiciousActivityEvent[]> {
    const { data, error } = await client()
      .from('suspicious_activity_events')
      .select('id,actor_user_id,actor_name,actor_email,ip_address,event_type,severity,description,status,created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) fail(error);
    return ((data as SuspiciousRow[]) || []).map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id ?? undefined,
      actorName: r.actor_name ?? undefined,
      actorEmail: r.actor_email ?? undefined,
      ipAddress: r.ip_address ?? undefined,
      eventType: r.event_type as SuspiciousActivityEvent['eventType'],
      severity: r.severity as SuspiciousActivityEvent['severity'],
      description: r.description,
      status: r.status as SuspiciousActivityEvent['status'],
      createdAt: r.created_at
    }));
  }
};
