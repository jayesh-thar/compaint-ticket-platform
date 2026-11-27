import React from 'react';
import { Badge, type BadgeTone } from '../../../components/ui/form-controls';
import type { Priority, Stage } from '../tickets-api';

const STAGE: Record<Stage, { label: string; tone: BadgeTone }> = {
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'red' },
  AT_CATEGORY: { label: 'At category', tone: 'amber' },
  AT_TEAM: { label: 'Needs assignment', tone: 'amber' },
  ASSIGNED: { label: 'Assigned', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  TEAM_REVIEW: { label: 'Team review', tone: 'purple' },
  ADMIN_REVIEW: { label: 'Final approval', tone: 'purple' },
  DONE: { label: 'Done', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'slate' },
};

export const StageBadge: React.FC<{ stage: Stage; title?: string }> = ({ stage, title }) => (
  <Badge tone={STAGE[stage].tone} title={title}>
    {STAGE[stage].label}
  </Badge>
);

const PRIORITY_TONE: Record<Priority, BadgeTone> = { LOW: 'slate', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' };

export const PriorityBadge: React.FC<{ priority: Priority }> = ({ priority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{priority.charAt(0) + priority.slice(1).toLowerCase()}</Badge>
);

export const KindBadge: React.FC<{ kind: 'COMPLAINT' | 'TASK' }> = ({ kind }) => (
  <Badge tone={kind === 'COMPLAINT' ? 'purple' : 'slate'}>{kind === 'COMPLAINT' ? 'Complaint' : 'Task'}</Badge>
);

export const ProgressBar: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-label={`Progress ${value}%`}>
    <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${value}%` }} />
  </div>
);
