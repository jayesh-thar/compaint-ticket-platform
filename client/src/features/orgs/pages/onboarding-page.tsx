import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../components/ui/card';
import { Building2, MailOpen, PlusCircle, ArrowRight, LogOut, AlertCircle } from 'lucide-react';
import { useMyOrgs } from '../org-api';

export const OnboardingPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { data, isLoading, isError, refetch } = useMyOrgs();
  const orgs = data?.organizations ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="font-semibold text-slate-900">
          Complaint &amp; Ticket Portal
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 hidden sm:inline">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout} className="gap-1">
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </header>

      <main className="w-full max-w-3xl mx-auto p-6 space-y-8">
        <div className="text-center space-y-2 pt-4">
          <h1 className="text-3xl font-extrabold text-slate-900">Welcome, {user?.name}</h1>
          <p className="text-slate-500 text-sm max-w-md mx-auto">Open one of your organizations or create a new one.</p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        )}

        {isError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 p-3 text-sm text-red-800 bg-red-50 rounded-md border border-red-200"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Could not load your organizations.
            </span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {orgs.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Your organizations</CardTitle>
              <CardDescription>Select one to open its workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  to={`/w/${org.slug}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                      {org.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-900 text-sm truncate">{org.name}</h4>
                      <p className="text-xs text-slate-500">
                        /w/{org.slug} · {org.role}
                      </p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-blue-600">
                    Open <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="shadow-sm">
            <CardHeader>
              <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-2">
                <Building2 className="h-5 w-5" />
              </div>
              <CardTitle>Create an organization</CardTitle>
              <CardDescription>
                Set up a workspace for your college, company, or support department. You become its Admin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/orgs/new">
                <Button className="w-full gap-2">
                  <PlusCircle className="h-4 w-4" />
                  Create organization
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <div className="h-10 w-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center mb-2">
                <MailOpen className="h-5 w-5" />
              </div>
              <CardTitle>Were you invited?</CardTitle>
              <CardDescription>Team leaders and members join through an invitation link.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-600 leading-relaxed">
                Open the invitation link you received while logged in as the invited email address. The organization
                then appears in the list above.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};
