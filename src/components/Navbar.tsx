import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Plus,
  SlidersHorizontal,
  Check,
  User as UserIcon,
  LogOut,
  Building2,
  Lock,
  ChevronDown,
  Database,
  CreditCard,
  MessageSquare,
  Bell,
  Activity,
  FileText,
  Bookmark,
  Settings
} from 'lucide-react';
import { UserProfileModal } from './auth/UserProfileModal';
import { NotificationCenterModal } from './notifications/NotificationCenterModal';
import { OrganizationSwitcher } from './organization/OrganizationSwitcher';
import { OrganizationWizardModal } from './organization/OrganizationWizardModal';
import { OrganizationTeamModal } from './organization/OrganizationTeamModal';
import { PWAInstallButton } from './pwa/PWAInstallButton';
import { envConfig } from '../config/env';
import { CurrencySwitcher } from './common/CurrencySwitcher';
import { BrandLogo } from './common/BrandLogo';
import { useNotifications } from '../hooks/useNotifications';

interface NavbarProps {
  activeTab: 'opportunities' | 'businesses' | 'verification' | 'recruiter' | 'candidate' | 'ai-studio' | 'billing' | 'messages' | 'admin';
  setActiveTab: (tab: 'opportunities' | 'businesses' | 'verification' | 'recruiter' | 'candidate' | 'ai-studio' | 'billing' | 'messages' | 'admin') => void;
  currency: 'USD' | 'LRD';
  setCurrency: (c: 'USD' | 'LRD') => void;
  currentRole: UserRole;
  setCurrentRole: (r: UserRole) => void;
  onOpenPostModal: () => void;
  notificationCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  currency,
  setCurrency,
  currentRole,
  setCurrentRole,
  onOpenPostModal,
  notificationCount: _notificationCount
}) => {
  const { user, activeOrganization, switchRole, openAuthModal, logout, canAccessWorkspace } = useAuth();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isOrgWizardOpen, setIsOrgWizardOpen] = useState(false);
  const [isOrgTeamModalOpen, setIsOrgTeamModalOpen] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const {
    notifications,
    unreadCount: unreadNotifCount,
    loading: notificationsLoading,
    error: notificationsError,
    refresh: refreshNotifications,
    markAsRead: markNotificationRead,
    markAllAsRead: markAllNotificationsRead
  } = useNotifications(user?.id, { announce: !showNotificationsModal });

  const roleLabels: Record<
    UserRole,
    { title: string; badge: string; entity: string; iconBg: string }
  > = {
    job_seeker: {
      title: 'Talent & Job Seeker',
      badge: 'Candidate',
      entity: 'Tamba Kollie',
      iconBg: 'bg-[#283618]'
    },
    employer: {
      title: 'Save the Children',
      badge: 'Employer',
      entity: 'Dr. Evelyn Fahnbulleh',
      iconBg: 'bg-[#4F772D]'
    },
    recruiter: {
      title: 'West Africa Talent (Agency)',
      badge: 'Recruiter',
      entity: 'Korto Flomo',
      iconBg: 'bg-[#606C38]'
    },
    business_seller: {
      title: 'Business Seller (M&A)',
      badge: 'Seller',
      entity: 'Samuel Tweh (Pepperbird)',
      iconBg: 'bg-[#BC6C25]'
    },
    buyer: {
      title: 'Capitol Hill Capital (Buyer)',
      badge: 'Investor/Buyer',
      entity: 'Nathaniel Sherman',
      iconBg: 'bg-[#9A551A]'
    },
    service_provider: {
      title: 'Ganta Civil Services',
      badge: 'Contractor',
      entity: 'Eng. Patrick Sumo',
      iconBg: 'bg-[#283618]'
    },
    organization_admin: {
      title: 'Save the Children (Admin)',
      badge: 'Org Admin',
      entity: 'Madam Marie Weah',
      iconBg: 'bg-[#132A13]'
    },
    platform_admin: {
      title: 'Platform Administrator',
      badge: 'SuperAdmin',
      entity: 'National Governance',
      iconBg: 'bg-[#132A13]'
    },
    investor_buyer: {
      title: 'Capitol Hill Capital (Buyer)',
      badge: 'Investor/Buyer',
      entity: 'Nathaniel Sherman',
      iconBg: 'bg-[#9A551A]'
    },
    verification_officer: {
      title: 'LBR Verification Officer',
      badge: 'Gov Auditor',
      entity: 'Hon. Emmanuel Sumo',
      iconBg: 'bg-[#4F772D]'
    }
  };

  const handleRoleSelect = (r: UserRole) => {
    switchRole(r);
    setCurrentRole(r);
    setShowRoleDropdown(false);

    if (r === 'job_seeker') {
      setActiveTab('candidate');
    } else if (r === 'recruiter' || r === 'employer' || r === 'organization_admin') {
      setActiveTab('recruiter');
    } else if (r === 'verification_officer') {
      setActiveTab('verification');
    } else if (r === 'business_seller' || r === 'buyer') {
      setActiveTab('businesses');
    }
  };

  const userInitials = user
    ? (user.fullName || 'User')
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : '';

  return (
    <>
      <nav className="h-16 sm:h-20 w-full max-w-full bg-white border-b border-[#E8E4D9] flex items-center justify-between gap-2 px-3 sm:px-6 2xl:px-10 shrink-0 sticky top-0 z-40">
        {/* Brand Identity */}
        <div className="flex items-center gap-6 xl:gap-5 2xl:gap-8 min-w-0">
          <button
            onClick={() => setActiveTab('opportunities')}
            className="flex items-center gap-2 sm:gap-2.5 text-left focus:outline-none group cursor-pointer shrink-0"
          >
            <BrandLogo />
          </button>

          {/* Primary Marketplace Tabs */}
          <div className="hidden xl:flex items-center gap-0.5 2xl:gap-2 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-sm font-medium text-[#606C38]">
            <button
              onClick={() => setActiveTab('opportunities')}
              className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'opportunities'
                  ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                  : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
              }`}
            >
              All Opportunities
            </button>
            <button
              onClick={() => setActiveTab('businesses')}
              className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'businesses'
                  ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                  : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
              }`}
            >
              Business M&A
            </button>
            {user && canAccessWorkspace('verification').allowed && (
              <button
                onClick={() => setActiveTab('verification')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'verification'
                    ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                    : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-[#4F772D]" />
                Verification Hub
              </button>
            )}
            {user && canAccessWorkspace('recruiter').allowed && (
              <button
                onClick={() => setActiveTab('recruiter')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === 'recruiter'
                    ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                    : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
                }`}
              >
                Recruiter Studio
              </button>
            )}
            {user && canAccessWorkspace('candidate').allowed && (
              <button
                onClick={() => setActiveTab('candidate')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === 'candidate'
                    ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                    : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
                }`}
              >
                <span>Candidate Portal</span>
              </button>
            )}
            {user && (
              <button
                onClick={() => setActiveTab('ai-studio')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1 text-[#BC6C25] font-semibold cursor-pointer ${
                  activeTab === 'ai-studio'
                    ? 'bg-[#FEFAE0] border border-[#E8E4D9]'
                    : 'hover:bg-[#FEFAE0]/50'
                }`}
              >
                <span>✨ AI Copilot</span>
              </button>
            )}
            {user && canAccessWorkspace('billing').allowed && (
              <button
                onClick={() => setActiveTab('billing')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                  activeTab === 'billing'
                    ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                    : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
                }`}
              >
                <span>Subscriptions</span>
              </button>
            )}
            {user && (
              <button
                onClick={() => setActiveTab('messages')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'messages'
                    ? 'bg-[#ECF3E9] text-[#283618] font-bold'
                    : 'hover:text-[#283618] hover:bg-[#F9F8F6]'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-[#4F772D]" />
                <span>Messages</span>
              </button>
            )}
            {user && canAccessWorkspace('admin').allowed && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-2 2xl:px-3 py-2 rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'admin'
                    ? 'bg-[#283618] text-white font-bold'
                    : 'bg-red-50 text-red-800 hover:bg-red-100'
                }`}
              >
                <ShieldCheck className="w-4 h-4 text-red-600" />
                <span>Trust & Safety</span>
              </button>
            )}
          </div>
        </div>

        {/* Action Controls & Multi-Role Context */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          {/* Organization Multi-Tenant Switcher */}
          {user && (
            <OrganizationSwitcher onOpenCreateWizard={() => setIsOrgWizardOpen(true)} />
          )}

          {/* Desktop PWA Install Button */}
          <PWAInstallButton className="hidden md:inline-flex py-1.5 px-3 text-xs" />

          {/* Notification Bell */}
          <button
            onClick={() => {
              setShowNotificationsModal(true);
              refreshNotifications();
            }}
            className="w-9 h-9 sm:w-auto sm:h-auto sm:p-2.5 flex items-center justify-center bg-[#F9F8F6] hover:bg-[#ECF3E9] text-[#283618] rounded-xl border border-[#E8E4D9] relative transition-colors cursor-pointer shrink-0"
            aria-label={unreadNotifCount > 0 ? `Notifications, ${unreadNotifCount} unread` : 'Notifications'}
            title="Notifications"
          >
            <Bell className="w-4 h-4 text-[#283618]" />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-[#BC6C25] text-white rounded-full text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>
          {/* Display-currency switcher (phones get this in the More menu instead) */}
          <CurrencySwitcher variant="compact" className="hidden sm:flex" />

          {/* User Profile / Account Menu */}
          {user ? (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="flex items-center gap-1.5 sm:gap-2 pl-1.5 pr-2 sm:pl-2 sm:pr-2.5 h-9 sm:h-auto sm:py-1.5 bg-white border border-[#E8E4D9] rounded-xl hover:border-[#283618] transition-all cursor-pointer shrink-0"
                id="user-profile-menu-button"
                aria-label="Account menu"
              >
                <div className="w-7 h-7 rounded-lg bg-[#283618] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  {userInitials}
                </div>
                <div className="hidden 2xl:block text-left">
                  <div className="text-xs font-bold text-[#132A13] leading-tight truncate max-w-[120px]">
                    {user.fullName}
                  </div>
                  <div className="text-[10px] text-[#606C38] leading-tight capitalize">
                    {activeOrganization ? activeOrganization.name : user.primaryRole?.replace('_', ' ')}
                  </div>
                </div>
                <ChevronDown className="w-3 h-3 text-[#606C38]" />
              </button>

              {showUserDropdown && (
                <div className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto bg-white rounded-2xl border border-[#E8E4D9] shadow-2xl p-2 z-50 animate-fade-in" id="user-profile-dropdown">
                  <div className="px-3 py-2.5 border-b border-[#E8E4D9]">
                    <div className="font-bold text-xs text-[#132A13]">{user.fullName}</div>
                    <div className="text-[11px] text-[#606C38] truncate">{user.email}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold uppercase bg-[#ECF3E9] text-[#283618] px-2 py-0.5 rounded-full">
                        {user.accountStatus?.replace('_', ' ')}
                      </span>
                      {user.isEmailVerified && (
                        <span className="text-[10px] font-bold text-[#4F772D] flex items-center gap-0.5">
                          <Check className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="py-1 text-xs">
                    <button
                      onClick={() => {
                        setIsProfileModalOpen(true);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="profile-menu-item"
                    >
                      <UserIcon className="w-3.5 h-3.5 text-[#606C38]" />
                      Profile
                    </button>

                    <button
                      onClick={() => {
                        setActiveTab('candidate');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="activity-menu-item"
                    >
                      <Activity className="w-3.5 h-3.5 text-[#606C38]" />
                      My Activity
                    </button>
                    
                    <button
                      onClick={() => {
                        setActiveTab('candidate');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="applications-menu-item"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#606C38]" />
                      Applications
                    </button>
                    
                    <button
                      onClick={() => {
                        setActiveTab('opportunities');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="saved-menu-item"
                    >
                      <Bookmark className="w-3.5 h-3.5 text-[#606C38]" />
                      Saved Opportunities
                    </button>
                    
                    <button
                      onClick={() => {
                        setActiveTab('messages');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium flex justify-between"
                      id="messages-menu-item"
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-[#606C38]" />
                        Messages
                      </div>
                    </button>
                    
                    <button
                      onClick={() => {
                        setShowNotificationsModal(true);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium flex justify-between"
                      id="notifications-menu-item"
                    >
                      <div className="flex items-center gap-2">
                        <Bell className="w-3.5 h-3.5 text-[#606C38]" />
                        Notifications
                      </div>
                      {unreadNotifCount > 0 && (
                        <span className="bg-[#BC6C25] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          {unreadNotifCount}
                        </span>
                      )}
                    </button>

                    <div className="my-1 border-t border-[#E8E4D9]"></div>

                    <button
                      onClick={() => {
                        setIsProfileModalOpen(true);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="security-menu-item"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-[#606C38]" />
                      Security
                    </button>

                    <button
                      onClick={() => {
                        setIsProfileModalOpen(true);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#F9F8F6] text-[#283618] flex items-center gap-2 cursor-pointer font-medium"
                      id="settings-menu-item"
                    >
                      <Settings className="w-3.5 h-3.5 text-[#606C38]" />
                      Settings
                    </button>

                    <div className="my-1 border-t border-[#E8E4D9]"></div>

                    <button
                      onClick={() => {
                        logout();
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#FCF0E8] text-[#BC6C25] flex items-center gap-2 cursor-pointer font-medium"
                      id="signout-menu-item"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2 animate-fade-in shrink-0" id="guest-auth-controls">
              <button
                onClick={() => openAuthModal('login')}
                className="px-3 sm:px-4 h-9 sm:h-auto sm:py-2 border border-[#E8E4D9] text-[#283618] hover:border-[#283618] transition-all text-xs sm:text-sm font-semibold rounded-xl cursor-pointer bg-white hover:bg-[#F9F8F6] whitespace-nowrap"
                id="navbar-signin-button"
              >
                Sign In
              </button>
              <button
                onClick={() => openAuthModal('register')}
                className="px-3 sm:px-4 h-9 sm:h-auto sm:py-2 bg-[#283618] hover:bg-[#132A13] text-white transition-all text-xs sm:text-sm font-semibold rounded-xl shadow-xs cursor-pointer whitespace-nowrap"
                id="navbar-register-button"
              >
                <span className="sm:hidden">Join</span>
                <span className="hidden sm:inline">Create Account</span>
              </button>
            </div>
          )}

          {/* Post Opportunity CTA (tablet/desktop) */}
          {user && (
            <button
              onClick={onOpenPostModal}
              className="hidden sm:flex items-center gap-1.5 px-3.5 2xl:px-5 py-2.5 bg-[#283618] hover:bg-[#132A13] text-white rounded-xl text-sm font-semibold shadow-xs transition-transform active:scale-95 cursor-pointer whitespace-nowrap"
              id="post-opportunity-button"
            >
              <Plus className="w-4 h-4" />
              <span>Post<span className="hidden 2xl:inline"> Opportunity</span></span>
            </button>
          )}
        </div>
      </nav>

      {/* Post Opportunity: floating action button on phones, sits clear of the bottom bar */}
      {user && (
        <button
          onClick={onOpenPostModal}
          className="sm:hidden fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 h-12 pl-4 pr-5 bg-[#283618] text-white rounded-full text-sm font-semibold shadow-lg active:scale-95 transition-transform cursor-pointer"
          id="post-opportunity-fab"
          aria-label="Post opportunity"
        >
          <Plus className="w-5 h-5" />
          <span>Post</span>
        </button>
      )}

      {/* User Profile Modal */}
      {user && (
        <UserProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} />
      )}

      {/* Organization Creation & Onboarding Wizard */}
      <OrganizationWizardModal
        isOpen={isOrgWizardOpen}
        onClose={() => setIsOrgWizardOpen(false)}
      />

      {/* Organization Team & Access Management Modal */}
      <OrganizationTeamModal
        isOpen={isOrgTeamModalOpen}
        onClose={() => setIsOrgTeamModalOpen(false)}
        organization={activeOrganization}
      />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        onNavigateTab={(t) => setActiveTab(t as any)}
        notifications={notifications}
        loading={notificationsLoading}
        error={notificationsError}
        onRetry={refreshNotifications}
        onMarkAsRead={markNotificationRead}
        onMarkAllAsRead={markAllNotificationsRead}
      />
    </>
  );
};
