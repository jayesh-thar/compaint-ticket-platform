import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError } from '../../shared/errors.js';
import { descriptionSchema, subjectSchema } from '../tickets/tickets.schemas.js';
import { nextTicketNumber, recordActivity } from '../tickets/tickets.repository.js';
import { ticketRef } from '../tickets/tickets.mapper.js';
import { notifyComplaintReceived, notifyNeedsAssignment } from '../notifications/outbox.js';

/**
 * The bottom-up entry (README 6.2). The organization comes ONLY from the URL
 * slug; source, status, priority, team and requester are set by the server.
 */

export const submitComplaintSchema = z.object({
  categoryId: z.string({ required_error: 'Choose a category.' }).uuid('Choose a category.'),
  subject: subjectSchema,
  description: descriptionSchema,
});

export type SubmitComplaintInput = z.infer<typeof submitComplaintSchema>;

/** Same answer for "no such organization" and "portal switched off". */
const unavailable = () => new AppError(404, 'NOT_FOUND', 'This complaint portal is not available.');

const findOpenPortal = async (slug: string) => {
  const org = await prisma.organization.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!org || !org.portalEnabled) throw unavailable();
  return org;
};

const publicCategories = (orgId: string) =>
  prisma.category.findMany({
    where: { organizationId: orgId, isPublic: true, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

/** Public (no login). Safe fields only - nothing about teams, members, or tickets. */
export const getPortal = async (slug: string) => {
  const org = await findOpenPortal(slug);
  const categories = await publicCategories(org.id);
  return {
    portal: {
      name: org.name,
      slug: org.slug,
      intro: org.portalIntro,
      // Enabled, but every public category was archived: "not accepting complaints".
      acceptingComplaints: categories.length > 0,
      categories,
    },
  };
};

export const submitComplaint = async (user: User, slug: string, input: SubmitComplaintInput) => {
  const org = await findOpenPortal(slug);

  // Reference check: the category must be PUBLIC, ACTIVE, and of THIS organization.
  const category = await prisma.category.findFirst({
    where: { id: input.categoryId, organizationId: org.id, isPublic: true, archivedAt: null },
    include: { defaultTeam: true },
  });
  if (!category) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Choose one of the categories shown on this page.', {
      categoryId: 'Choose one of the categories shown on this page.',
    });
  }
  // An archived default team means "unrouted": Managers triage it (README 10).
  const teamId = category.defaultTeam && !category.defaultTeam.archivedAt ? category.defaultTeam.id : null;

  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextTicketNumber(tx, org.id);
    const created = await tx.ticket.create({
      data: {
        organizationId: org.id,
        number,
        source: 'PORTAL',
        status: 'OPEN',
        priority: 'MEDIUM', // requesters cannot choose a priority
        subject: input.subject,
        description: input.description,
        categoryId: category.id,
        teamId,
        requesterId: user.id,
        createdByMembershipId: null,
      },
    });
    await recordActivity(tx, {
      organizationId: org.id,
      ticketId: created.id,
      actorUserId: user.id,
      type: 'CREATED',
      toValue: ticketRef(number),
      note: 'Submitted through the portal',
    });
    await notifyComplaintReceived(tx, created);
    await notifyNeedsAssignment(tx, created, user.id);
    return created;
  });

  return {
    complaint: {
      reference: ticketRef(ticket.number),
      number: ticket.number,
      organization: { name: org.name, slug: org.slug },
    },
  };
};
