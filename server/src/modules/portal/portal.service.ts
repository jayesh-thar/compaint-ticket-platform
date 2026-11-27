import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { AppError } from '../../shared/errors.js';
import { generateToken, hashToken, normalizeEmail } from '../../shared/crypto.js';
import { sendComplaintReceivedEmail } from '../../shared/email.js';
import { publish } from '../../shared/events.js';
import { notify } from '../notifications/outbox.js';
import { addActivity, nextNumber } from '../tickets/tickets.service.js';
import { STAGE_LABEL } from '../tickets/stage-machine.js';

/**
 * Customer side (D-22): no account. The public form creates a COMPLAINT that
 * waits for Admin approval; the customer gets a reference and a private
 * tracking link (random token, only its hash is stored).
 */

export const complaintSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.string().trim().email('Invalid email address').max(254).transform(normalizeEmail),
  phoneCode: z
    .string()
    .trim()
    .regex(/^\+\d{1,4}$/, 'Choose a country code'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9 ()-]{4,20}$/, 'Enter a valid phone number'),
  categoryId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(200),
  description: z.string().trim().min(10, 'Please describe the problem in a few sentences').max(10000),
  /** Honeypot: humans never see this field; bots fill it. */
  website: z.string().max(200).optional(),
});
export const trackSchema = z.object({ token: z.string().min(10).max(200) });

const unavailable = () => new AppError(404, 'NOT_FOUND', 'This complaint page is not available.');

export const getPublicPortal = async (slug: string) => {
  const org = await prisma.organization.findUnique({
    where: { slug: slug.toLowerCase() },
    include: {
      categories: { where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } },
    },
  });
  if (!org) throw unavailable();
  return {
    portal: {
      name: org.name,
      slug: org.slug,
      intro: org.portalIntro,
      accepting: org.portalEnabled,
      categories: org.portalEnabled ? org.categories : [],
    },
  };
};

export const submitComplaint = async (slug: string, input: z.infer<typeof complaintSchema>) => {
  const org = await prisma.organization.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!org) throw unavailable();
  if (!org.portalEnabled)
    throw new AppError(422, 'VALIDATION_ERROR', `${org.name} is not accepting complaints right now.`);

  // A bot filled the hidden field: answer like a success, store nothing.
  if (input.website) {
    logger.warn({ org: org.slug }, 'Complaint honeypot triggered');
    return { reference: 'T-0', trackingToken: null, message: 'Complaint registered.' };
  }

  let categoryId: string | null = null;
  if (input.categoryId) {
    const c = await prisma.category.findFirst({
      where: { id: input.categoryId, organizationId: org.id, archivedAt: null },
    });
    if (!c) throw new AppError(422, 'VALIDATION_ERROR', 'Choose a category from the list.', { categoryId: 'Unknown.' });
    categoryId = c.id;
  }

  const rawToken = generateToken();
  const ticket = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, org.id);
    const t = await tx.ticket.create({
      data: {
        organizationId: org.id,
        number,
        kind: 'COMPLAINT',
        stage: 'PENDING_APPROVAL',
        subject: input.subject,
        description: input.description,
        categoryId,
        customerName: input.name,
        customerEmail: input.email,
        customerPhoneCode: input.phoneCode,
        customerPhone: input.phone,
        trackingTokenHash: hashToken(rawToken),
      },
    });
    await addActivity(tx, t, null, 'CREATED', { toValue: 'PENDING_APPROVAL', note: 'Submitted by the customer' });
    await notify(tx, t, 'NEEDS_APPROVAL', null);
    return t;
  });

  const reference = `T-${ticket.number}`;
  // Sent directly (not via the outbox) because it carries the tracking token.
  try {
    await sendComplaintReceivedEmail(input.email, rawToken, org.name, reference, input.subject);
  } catch (err) {
    logger.error({ err, reference }, 'Complaint confirmation email failed');
  }
  publish(org.id, 'tickets');
  return { reference, trackingToken: rawToken, message: 'Complaint registered.' };
};

/** Status only: no staff names, no comments, no internal data (README 0.4). */
export const trackComplaint = async (token: string) => {
  const t = await prisma.ticket.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    include: { organization: { select: { name: true, slug: true } }, category: { select: { name: true } } },
  });
  if (!t || t.kind !== 'COMPLAINT') throw new AppError(404, 'NOT_FOUND', 'This tracking link is not valid.');
  const step =
    t.stage === 'PENDING_APPROVAL'
      ? 1
      : t.stage === 'DONE' || t.stage === 'REJECTED'
        ? 4
        : t.stage === 'ADMIN_REVIEW' || t.stage === 'TEAM_REVIEW'
          ? 3
          : 2;
  return {
    complaint: {
      reference: `T-${t.number}`,
      organization: t.organization.name,
      subject: t.subject,
      category: t.category?.name ?? 'Other',
      stage: t.stage,
      status:
        t.stage === 'DONE'
          ? 'Resolved'
          : t.stage === 'REJECTED'
            ? 'Not accepted'
            : t.stage === 'PENDING_APPROVAL'
              ? 'Received - waiting for review'
              : 'Being worked on',
      detail:
        t.stage === 'PENDING_APPROVAL' || t.stage === 'DONE' || t.stage === 'REJECTED' ? STAGE_LABEL[t.stage] : null,
      step,
      rejectionReason: t.stage === 'REJECTED' ? t.closeNote : null,
      submittedAt: t.createdAt,
      updatedAt: t.updatedAt,
      finishedAt: t.finishedAt,
    },
  };
};
