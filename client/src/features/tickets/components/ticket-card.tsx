import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckSquare, Users } from 'lucide-react';
import type { TicketListItem } from '../tickets-api';
import { KindBadge, PriorityBadge, ProgressBar, StageBadge } from './ticket-badges';
import { EmptyState } from '../../../components/states';

/** One ticket as a card: stage, priority, deadline, who works on it, progress. */
export const TicketCard: React.FC<{ slug: string; t: TicketListItem }> = ({ slug, t }) => (
  <Link
    to={`/w/${slug}/tickets/${t.number}`}
    className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-400 hover:shadow"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-400">{t.reference}</p>
        <h3 className="truncate text-sm font-semibold text-slate-900">{t.subject}</h3>
      </div>
      <PriorityBadge priority={t.priority} />
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <StageBadge stage={t.stage} title={t.stageLabel} />
      <KindBadge kind={t.kind} />
      {t.team && <span className="text-xs text-slate-500">{t.team.name}</span>}
      {!t.team && t.category && <span className="text-xs text-slate-500">{t.category.name}</span>}
    </div>
    <ProgressBar value={t.progress} />
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className={`flex items-center gap-1 ${t.overdue ? 'font-semibold text-red-600' : ''}`}>
        <CalendarClock className="h-3.5 w-3.5" />
        {t.dueDate ? `${t.overdue ? 'Overdue ' : 'Due '}${t.dueDate}` : 'No deadline'}
      </span>
      <span className="flex items-center gap-1">
        <Users className="h-3.5 w-3.5" />
        {t.assignees.length === 0
          ? 'Nobody yet'
          : t.groupName
            ? `${t.groupName} (${t.assignees.length})`
            : t.assignees[0].name}
      </span>
      {t.checklist.total > 0 && (
        <span className="flex items-center gap-1">
          <CheckSquare className="h-3.5 w-3.5" />
          {t.checklist.done}/{t.checklist.total}
        </span>
      )}
    </div>
  </Link>
);

export const TicketGrid: React.FC<{ slug: string; tickets: TicketListItem[]; empty: string; hint?: string }> = ({
  slug,
  tickets,
  empty,
  hint,
}) =>
  tickets.length === 0 ? (
    <EmptyState title={empty} hint={hint} />
  ) : (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tickets.map((t) => (
        <TicketCard key={t.number} slug={slug} t={t} />
      ))}
    </div>
  );
