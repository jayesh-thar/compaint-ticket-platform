import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import { RequireAuth } from '../features/auth/components/require-auth';
import { RequireVerified } from '../features/auth/components/require-verified';
import { LoginPage } from '../features/auth/pages/login-page';
import { RegisterPage } from '../features/auth/pages/register-page';
import { VerifyEmailPage } from '../features/auth/pages/verify-email-page';
import { ResendVerificationPage } from '../features/auth/pages/resend-verification-page';
import { ForgotPasswordPage } from '../features/auth/pages/forgot-password-page';
import { ResetPasswordPage } from '../features/auth/pages/reset-password-page';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { ShieldCheck, LogOut } from 'lucide-react';

const HomePage: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <header className="max-w-4xl mx-auto flex items-center justify-between py-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Complaint & Ticket Management</h1>
          <p className="text-xs text-slate-500">Welcome, {user?.name}</p>
        </div>
        <Button variant="outline" size="sm" onClick={logout} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </header>
      <main className="max-w-4xl mx-auto py-8">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-emerald-600 mb-1">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wider">Authenticated & Verified</span>
            </div>
            <CardTitle>Welcome to your portal</CardTitle>
            <CardDescription>
              Your account ({user?.email}) is verified and ready for Phase 3 (Organizations and Workspaces).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              Phase 2 Authentication and Session management are fully working. Organizations, teams, and tickets will be loaded here in upcoming phases.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export const AppRouter: React.FC = () => {
  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/resend-verification" element={<ResendVerificationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected Routes */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <RequireVerified>
              <HomePage />
            </RequireVerified>
          </RequireAuth>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
