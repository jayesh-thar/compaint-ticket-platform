import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from '../features/auth/components/require-auth';
import { RequireVerified } from '../features/auth/components/require-verified';
import { LoginPage } from '../features/auth/pages/login-page';
import { RegisterPage } from '../features/auth/pages/register-page';
import { VerifyEmailPage } from '../features/auth/pages/verify-email-page';
import { ResendVerificationPage } from '../features/auth/pages/resend-verification-page';
import { ForgotPasswordPage } from '../features/auth/pages/forgot-password-page';
import { ResetPasswordPage } from '../features/auth/pages/reset-password-page';
import { LandingPage } from '../features/landing/pages/landing-page';
import { OnboardingPage } from '../features/orgs/pages/onboarding-page';
import { CreateOrgPage } from '../features/orgs/pages/create-org-page';
import { WorkspaceLayout } from '../features/orgs/components/workspace-layout';
import { DashboardPage } from '../features/dashboard/pages/dashboard-page';
import { OrgSettingsPage } from '../features/orgs/pages/org-settings-page';
import { MembersPage } from '../features/members/pages/members-page';
import { AcceptInvitePage } from '../features/members/pages/accept-invite-page';
import { TeamsPage } from '../features/teams/pages/teams-page';
import { CategoriesPage } from '../features/categories/pages/categories-page';
import { TicketListPage } from '../features/tickets/pages/ticket-list-page';
import { NewTicketPage } from '../features/tickets/pages/new-ticket-page';
import { TicketDetailPage } from '../features/tickets/pages/ticket-detail-page';
import { PortalPage } from '../features/portal/pages/portal-page';
import { TrackPage } from '../features/portal/pages/track-page';
import { TeamPage } from '../features/teams/pages/team-page';

/** Logged in + verified email. */
const ProtectedShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RequireAuth>
    <RequireVerified>{children}</RequireVerified>
  </RequireAuth>
);

export const AppRouter: React.FC = () => {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/resend-verification" element={<ResendVerificationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Invitation: public on purpose. The page itself handles "not logged in",
          "not verified" and "wrong account", so the #token is never lost in a redirect. */}
      <Route path="/invite" element={<AcceptInvitePage />} />

      {/* Customer side (no account): complaint form from the shared link, private tracking page. */}
      <Route path="/o/:slug" element={<PortalPage />} />
      <Route path="/track" element={<TrackPage />} />

      {/* Public landing page */}
      <Route path="/" element={<LandingPage />} />

      {/* Onboarding: home for logged-in users (their organizations, create one) */}
      <Route
        path="/start"
        element={
          <ProtectedShell>
            <OnboardingPage />
          </ProtectedShell>
        }
      />
      <Route
        path="/orgs/new"
        element={
          <ProtectedShell>
            <CreateOrgPage />
          </ProtectedShell>
        }
      />

      {/* Workspace (organization comes from the URL slug) */}
      <Route
        path="/w/:slug"
        element={
          <ProtectedShell>
            <WorkspaceLayout />
          </ProtectedShell>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="tickets" element={<TicketListPage />} />
        <Route path="tickets/new" element={<NewTicketPage />} />
        <Route path="tickets/:number" element={<TicketDetailPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:teamId" element={<TeamPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="settings" element={<OrgSettingsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
