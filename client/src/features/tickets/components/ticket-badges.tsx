import React from 'react';
import { Badge, type BadgeTone } from '../../../components/ui/form-controls';
import {
  CLOSE_REASON_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type CloseReason,
  type TicketPriority,
  type TicketStatus,
} from '../tickets-api';

const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  OPEN: 'blue',
  IN_PROGRESS: 'purple',
  WAITING_ON_REQUESTER: 'amber',
  RESOLVED: 'green',
  CLOSED: 'slate',
};

const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = {
  LOW: 'slate',
  MEDIUM: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

export const StatusBadge: React.FC<{ status: TicketStatus; closeReason?: CloseReason | null }> = ({
  status,
  closeReason,
}) => (
  <Badge tone={STATUS_TONE[status]}>
    {STATUS_LABEL[status]}
    {status === 'CLOSED' && closeReason ? ` · ${CLOSE_REASON_LABEL[closeReason]}` : ''}
  </Badge>
);

export const PriorityBadge: React.FC<{ priority: TicketPriority }> = ({ priority }) => (
  <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>
);
