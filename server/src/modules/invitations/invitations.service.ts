import type { Invitation } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { generateToken, hashToken, normalizeEmail } from '../../shared/crypto.js';
import { sendInvitationEmail } from '../../shared/email.js';
import type { CreateInvitationInput, AcceptInvitationInput } from './invitations.schemas.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const toInvitationDto = (inv: Invitation) => ({
  id: inv.id,
  email: inv.email,
  role: inv.role,
  expiresAt: inv.expiresAt,
  expired: inv.expiresAt <= new Date(),
  createdAt: inv.createdAt,
});

// "Pending" = not accepted and not revoked. Expired ones still count, so the
// Admin resends them instead of piling up duplicates (one pending per org+email).
const pendingWhere = (orgId: string) => ({
  organizationId: orgId,
  acceptedAt: null,
  revokedAt: null,
});

const invalidLink = () =>
  new AppError(
    400,
    'VALIDATION_ERROR',
    'This invitation link is invalid, expired, revoked, or already used. Ask an Admin to resend it.'
  );

const alreadyMember = () => new AppError(409, 'ALREADY_MEMBER', 'You are already a member of this organization.');

export const createInvitation = async (
  org: { id: string; name: string },
  inviterMembershipId: string,
  input: CreateInvitationInput
) => {
  const activeMember = await prisma.membership.findFirst({
    where: { organizationId: org.id, status: 'ACTIVE', user: { email: input.email } },
  });
  if (activeMember) {
    throw new AppError(409, 'ALREADY_MEMBER', 'This person is already a member of the organization.', {
      email: 'Already a member.',
    });
  }

  const pending = await prisma.invitation.findFirst({
    where: { ...pendingWhere(org.id), email: input.email },
  });
  if (pending) {
    throw new AppError(409, 'CONFLICT', 'An invitation for this email is already pending. Use Resend instead.', {
      email: 'Invitation already pending.',
    });
  }

  // Only the hash is stored; the raw token exists only inside the email link.
  const rawToken = generateToken();
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: org.id,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(rawToken),
      invitedByMembershipId: inviterMembershipId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  });

  // Account emails are sent directly (not via the outbox) because they carry a token.
  await sendInvitationEmail(input.email, rawToken, org.name, input.role);

  return { invitation: toInvitationDto(invitation), message: 'Invitation sent.' };
};

export const listInvitations = async (orgId: string) => {
  const invitations = await prisma.invitation.findMany({
    where: pendingWhere(orgId),
    orderBy: { createdAt: 'desc' },
  });
  return { invitations: invitations.map(toInvitationDto) };
};

export const resendInvitation = async (org: { id: string; name: string }, invitationId: string) => {
  const invitation = await prisma.invitation.findFirst({
    where: { ...pendingWhere(org.id), id: invitationId },
  });
  if (!invitation) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');

  // A new token replaces the old hash, so the previous link stops working.
  const rawToken = generateToken();
  const updated = await prisma.invitation.update({
    where: { id: invitation.id },
    data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
  });

  await sendInvitationEmail(updated.email, rawToken, org.name, updated.role);

  return { invitation: toInvitationDto(updated), message: 'Invitation resent.' };
};

export const revokeInvitation = async (orgId: string, invitationId: string) => {
  const { count } = await prisma.invitation.updateMany({
    where: { ...pendingWhere(orgId), id: invitationId },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
  return { id: invitationId, message: 'Invitation revoked.' };
};

export const acceptInvitation = async (currentUser: { id: string; email: string }, input: AcceptInvitationInput) => {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { organization: { select: { name: true, slug: true } } },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
    throw invalidLink();
  }

  if (normalizeEmail(currentUser.email) !== normalizeEmail(invitation.email)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'This invitation was sent to another email address. Log in with that account to accept it.'
    );
  }

  try {
    const membership = await prisma.$transaction(async (tx) => {
      // Claim the invitation with a conditional update: if two requests race,
      // only one of them changes the row; the other sees count = 0.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw invalidLink();

      const existing = await tx.membership.findUnique({
        where: {
          organizationId_userId: { organizationId: invitation.organizationId, userId: currentUser.id },
        },
      });

      if (existing?.status === 'ACTIVE') throw alreadyMember();

      if (existing) {
        // Previously removed: reactivate the same row so their history stays linked.
        return tx.membership.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', role: invitation.role, removedAt: null },
        });
      }

      return tx.membership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: currentUser.id,
          role: invitation.role,
          status: 'ACTIVE',
        },
      });
    });

    return {
      organization: invitation.organization,
      role: membership.role,
      membershipId: membership.id,
      message: 'Invitation accepted.',
    };
  } catch (error) {
    if (isUniqueViolation(error)) throw alreadyMember();
    throw error;
  }
};
