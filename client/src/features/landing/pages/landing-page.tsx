import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  GitBranch,
  Layers,
  MessageSquareWarning,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { useAuth } from '../../auth/auth-context';
import { Button } from '../../../components/ui/button';

/** One step of a flow strip: a numbered box with a short label. */
const FlowStep: React.FC<{ n: number; title: string; text: string; tone: 'blue' | 'emerald' }> = ({
  n,
  title,
  text,
  tone,
}) => (
  <li className="relative flex-1 min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <span
      className={
        'mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ' +
        (tone === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700')
      }
    >
      {n}
    </span>
    <p className="text-sm font-semibold text-slate-900">{title}</p>
    <p className="mt-1 text-xs leading-relaxed text-slate-500">{text}</p>
  </li>
);

const features = [
  {
    icon: Layers,
    title: 'Categories group your teams',
    text: 'Put "Server team 01" and "Server team 02" under "Server issue". A Category Lead picks the right team.',
  },
  {
    icon: Users,
    title: 'One leader per team',
    text: 'Each team has a Head, Lead or Manager who invites members, assigns work and reviews it.',
  },
  {
    icon: ClipboardList,
    title: 'Priority, deadline, checklist',
    text: 'Every ticket carries its priority, a deadline and a checklist, assigned to one person or a temporary group.',
  },
  {
    icon: Workflow,
    title: 'Live flow graph',
    text: 'See where every ticket is right now: waiting for approval, at a category, in a team, or done.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval both ways',
    text: 'Complaints are approved by an Admin before work starts; finished work is approved by the leader and the Admin.',
  },
  {
    icon: CheckCircle2,
    title: 'Full history',
    text: 'Closed work moves to history with who did what, when, so Admins and leaders can look back.',
  },
];

export const LandingPage: React.FC = () => {
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <GitBranch className="h-4 w-4" />
            </span>
            <span className="hidden sm:inline">Complaint &amp; Ticket Portal</span>
          </Link>
          <nav className="flex items-center gap-2">
            {isLoading ? null : user ? (
              <Link to="/start">
                <Button size="sm" className="gap-1">
                  Open workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Create account</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-14 text-center sm:px-6 sm:pt-20">
          <p className="mx-auto mb-4 w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            For colleges, companies and support departments
          </p>
          <h1 className="mx-auto max-w-3xl text-3xl font-extrabold tracking-tight sm:text-5xl">
            Every complaint and every task, routed to the right team and approved on the way back.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Customers send complaints through your shared link. Admins approve them, Category Leads route them, team
            leaders assign them, and members do the work. Internal tasks go straight to a team.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {user ? (
              <Link to="/start">
                <Button size="lg" className="gap-2">
                  Open workspace <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/register">
                  <Button size="lg" className="gap-2">
                    <Building2 className="h-4 w-4" /> Create account and set up your organization
                  </Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="outline">
                    I already have an account
                  </Button>
                </Link>
              </>
            )}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Want to report a problem? Use the complaint link your organization gave you. You don&apos;t need an account.
          </p>
        </section>

        <section className="mx-auto max-w-6xl space-y-8 px-4 pb-14 sm:px-6">
          <div>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
              <MessageSquareWarning className="h-5 w-5 text-blue-600" /> Customer complaint
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              From the shared link down to the person who fixes it, and back up.
            </p>
            <ol className="flex flex-col gap-3 md:flex-row">
              <FlowStep n={1} tone="blue" title="Customer submits" text="Name, email, phone, category, problem." />
              <FlowStep n={2} tone="blue" title="Admin approves" text="Or rejects it with a reason." />
              <FlowStep n={3} tone="blue" title="Category Lead" text="Chooses the team inside the category." />
              <FlowStep n={4} tone="blue" title="Team leader" text="Assigns a member or a group, with a deadline." />
              <FlowStep n={5} tone="blue" title="Back up" text="Member submits, leader approves, Admin approves." />
            </ol>
          </div>
          <div>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
              <ClipboardList className="h-5 w-5 text-emerald-600" /> Internal task
            </h2>
            <p className="mb-4 text-sm text-slate-500">Raised by an Admin or a team leader, straight to a team.</p>
            <ol className="flex flex-col gap-3 md:flex-row">
              <FlowStep n={1} tone="emerald" title="Raise a task" text="Tasks, priority and deadline." />
              <FlowStep n={2} tone="emerald" title="Team leader" text="Assigns a member or a group." />
              <FlowStep n={3} tone="emerald" title="Member works" text="Accepts, updates progress, submits." />
              <FlowStep n={4} tone="emerald" title="Approved" text="Leader, then Admin. Moves to history." />
            </ol>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-lg border border-slate-200 p-5">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        Complaint &amp; Ticket Portal
      </footer>
    </div>
  );
};
