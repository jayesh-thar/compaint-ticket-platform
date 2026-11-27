import { z } from 'zod';
import type { Invitation } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError, isUniqueViolation } from '../../shared/errors.js';
import { generateToken, hashToken, normalizeEmail } from '../../shared/crypto.js';
import { sendInvitationEmail } from '../../shared/email.js';
import { isAdmin, isLeaderOf, type Actor } from '../../shared/permissions.js';
import { publish } from '../../shared/events.js';
import { jobTitleSchema } from '../members/members.service.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const createInvitationSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').max(254).transform(normalizeEmail),
    role: z.enum(['ADMIN', 'STAFF']).default('STAFF'),
    jobTitle: jobTitleSchema.optional(),
    teamId: z.string().uuid().nullable().optional(),
    teamRole: z.enum(['LEADER', 'MEMBER']).optional(),
    leaderTitle: z.enum(['HEAD', 'LEAD', 'MANAGER']).optional(),
  })
  .refine((v) => !v.teamRole || !!v.teamId, { message: 'Choose a team.', path: ['teamId'] })
  .refine((v) => v.teamRole !== 'LEADER' || !!v.leaderTitle, {
    message: 'Choose Head, Lead or Manager.',
    path: ['leaderTitle'],
  });
export const acceptInvitationSchema = z.object({ token: z.string().min(1, 'Token is required').max(200) });

type CreateInput = z.infer<typeof createInvitationSchema>;

const TITLE_WORD = { HEAD: 'Head', LEAD: 'Lead', MANAGER: 'Manager' } as const;

const describe = (inv: Pick<Invitation, 'role' | 'teamRole' | 'leaderTitle'>, teamName: string | null) =>
  teamName
    ? inv.teamRole === 'LEADER'
      ? `${TITLE_WORD[inv.leaderTitle ?? 'LEAD']} of the team "${teamName}"`
      : `member of the team "${teamName}"`
    : inv.role === 'ADMIN'
      ? 'Admin'
      : 'Staff';

const toDto = (inv: Invitation & { team?: { name: string } | null }) => ({
  id: inv.id,
  email: inv.email,
  role: inv.role,
  jobTitle: inv.jobTitle,
  team: inv.teamId ? { id: inv.teamId, name: inv.team?.name ?? '(deleted team)' } : null,
  teamRole: inv.teamRole,
  leaderTitle: inv.leaderTitle,
  expiresAt: inv.expiresAt,
  expired: inv.expiresAt <= new Date(),
  createdAt: inv.createdAt,
});

const pendingWhere = (orgId: string) => ({ organizationId: orgId, acceptedAt: null, revokedAt: null });

/**
 * Accept failures are also printed in the console while email is not set up
 * (README 0.8), so the owner sees why a link did not work. Never the token.
 */
const logAcceptFailure = (reason: string, email: string, organization?: string) => {
  logger.warn({ reason, email, organization }, 'Invitation accept failed');
  if (env.NODE_ENV !== 'test') {
    console.warn(
      `\n===== INVITATION ACCEPT FAILED =====\n${JSON.stringify(
        { reason, email, organization, at: new Date().toISOString() },
        null,
        2
      )}\n====================================\n`
    );
  }
};

/** Admin: anything. Team Leader: Staff members of their own team only (README 0.8). */
const checkInvitePermission = (actor: Actor, input: Pick<CreateInput, 'role' | 'teamId' | 'teamRole'>) => {
  if (isAdmin(actor)) return;
  const ok = input.role === 'STAFF' && !!input.teamId && isLeaderOf(actor, input.teamId) && input.teamRole === 'MEMBER';
  if (!ok) {
    throw new AppError(403, 'FORBIDDEN', 'Team leaders can only invite members to their own team.');
  }
};

const canHandleInvitation = (actor: Actor, inv: Pick<Invitation, 'teamId'>) =>
  isAdmin(actor) || isLeaderOf(actor, inv.teamId);

export const createInvitation = async (actor: Actor, org: { id: string; name: string }, rawInput: CreateInput) => {
  const input = { ...rawInput, teamRole: rawInput.teamId ? (rawInput.teamRole ?? 'MEMBER') : undefined };
  checkInvitePermission(actor, input);

  let teamName: string | null = null;
  if (input.teamId) {
    const team = await prisma.team.findFirst({ where: { id: input.teamId, organizationId: org.id, archivedAt: null } });
    if (!team) throw new AppError(422, 'VALIDATION_ERROR', 'Team not found.', { teamId: 'Unknown team.' });
    teamName = team.name;
    if (input.teamRole === 'LEADER') {
      const leader = await prisma.teamMember.findFirst({ where: { teamId: team.id, role: 'LEADER' } });
      if (leader) {
        throw new AppError(
          409,
          'CONFLICT',
          'This team already has a leader. Change the leader on the team page first.',
          {
            teamRole: 'Team already has a leader.',
          }
        );
      }
    }
  }

  // An active member may still be invited INTO a team (they get added on accept).
  const activeMember = await prisma.membership.findFirst({
    where: { organizationId: org.id, status: 'ACTIVE', user: { email: input.email } },
  });
  if (activeMember && !input.teamId) {
    throw new AppError(409, 'ALREADY_MEMBER', 'This person is already a member of the organization.', {
      email: 'Already a member.',
    });
  }

  const pending = await prisma.invitation.findFirst({ where: { ...pendingWhere(org.id), email: input.email } });
  if (pending) {
    throw new AppError(409, 'CONFLICT', 'An invitation for this email is already pending. Use Resend instead.', {
      email: 'Invitation already pending.',
    });
  }

  const rawToken = generateToken();
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: org.id,
      email: input.email,
      role: input.role,
      jobTitle: input.jobTitle || null,
      teamId: input.teamId ?? null,
      teamRole: input.teamRole ?? null,
      leaderTitle: input.teamRole === 'LEADER' ? input.leaderTitle! : null,
      tokenHash: hashToken(rawToken),
      invitedByMembershipId: actor.membershipId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
    include: { team: { select: { name: true } } },
  });

  await sendInvitationEmail(input.email, rawToken, org.name, describe(invitation, teamName));
  publish(org.id, 'structure');
  return { invitation: toDto(invitation), message: 'Invitation sent.' };
};

export const listInvitations = async (actor: Actor) => {
  if (!isAdmin(actor) && actor.leadTeamIds.length === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Only Admins and team leaders manage invitations.');
  }
  const invitations = await prisma.invitation.findMany({
    where: { ...pendingWhere(actor.organizationId), ...(isAdmin(actor) ? {} : { teamId: { in: actor.leadTeamIds } }) },
    include: { team: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { invitations: invitations.map(toDto) };
};

const findPending = async (actor: Actor, invitationId: string) => {
  const inv = await prisma.invitation.findFirst({
    where: { ...pendingWhere(actor.organizationId), id: invitationId },
    include: { team: { select: { name: true } } },
  });
  if (!inv || !canHandleInvitation(actor, inv)) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
  return inv;
};

export const resendInvitation = async (actor: Actor, org: { id: string; name: string }, invitationId: string) => {
  const inv = await findPending(actor, invitationId);
  // A new token replaces the old hash, so the previous link stops working.
  const rawToken = generateToken();
  const updated = await prisma.invitation.update({
    where: { id: inv.id },
    data: { tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    include: { team: { select: { name: true } } },
  });
  await sendInvitationEmail(updated.email, rawToken, org.name, describe(updated, updated.team?.name ?? null));
  return { invitation: toDto(updated), message: 'Invitation resent.' };
};

export const revokeInvitation = async (actor: Actor, invitationId: string) => {
  const inv = await findPending(actor, invitationId);
  await prisma.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  publish(actor.organizationId, 'structure');
  return { id: inv.id, message: 'Invitation revoked.' };
};

const invalidLink = () =>
  new AppError(
    400,
    'VALIDATION_ERROR',
    'This invitation link is invalid, expired, revoked, or already used. Ask the person who invited you to resend it.'
  );

export const acceptInvitation = async (currentUser: { id: string; email: string }, input: { token: string }) => {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { organization: { select: { name: true, slug: true } }, team: true },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
    const reason = !invitation
      ? 'Unknown or replaced link'
      : invitation.acceptedAt
        ? 'Link already used'
        : invitation.revokedAt
          ? 'Invitation revoked'
          : 'Invitation expired';
    logAcceptFailure(reason, currentUser.email, invitation?.organization.name);
    throw invalidLink();
  }

  if (normalizeEmail(currentUser.email) !== normalizeEmail(invitation.email)) {
    logAcceptFailure(
      `Logged in as another email (invited: ${invitation.email})`,
      currentUser.email,
      invitation.organization.name
    );
    throw new AppError(
      403,
      'FORBIDDEN',
      'This invitation was sent to another email address. Log in with that account to accept it.'
    );
  }

  try {
    const membership = await prisma.$transaction(async (tx) => {
      // Claim with a conditional update: of two racing requests only one wins.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw invalidLink();

      const existing = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: currentUser.id } },
      });
      if (existing?.status === 'ACTIVE' && !invitation.teamId) {
        throw new AppError(409, 'ALREADY_MEMBER', 'You are already a member of this organization.');
      }

      const jobTitle = invitation.jobTitle ?? undefined;
      const m = existing
        ? await tx.membership.update({
            where: { id: existing.id },
            data:
              existing.status === 'ACTIVE'
                ? { jobTitle } // already in: just join the team
                : { status: 'ACTIVE', role: invitation.role, removedAt: null, jobTitle: invitation.jobTitle },
          })
        : await tx.membership.create({
            data: {
              organizationId: invitation.organizationId,
              userId: currentUser.id,
              role: invitation.role,
              status: 'ACTIVE',
              jobTitle: invitation.jobTitle,
            },
          });

      if (invitation.teamId) {
        if (!invitation.team || invitation.team.archivedAt) {
          throw new AppError(
            409,
            'CONFLICT',
            'The team of this invitation no longer exists. Ask for a new invitation.'
          );
        }
        const role = invitation.teamRole ?? 'MEMBER';
        const data = { role, leaderTitle: role === 'LEADER' ? invitation.leaderTitle : null };
        await tx.teamMember.upsert({
          where: { teamId_membershipId: { teamId: invitation.teamId, membershipId: m.id } },
          create: { organizationId: invitation.organizationId, teamId: invitation.teamId, membershipId: m.id, ...data },
          update: data,
        });
      }
      return m;
    });

    publish(invitation.organizationId, 'structure');
    return {
      organization: invitation.organization,
      role: membership.role,
      membershipId: membership.id,
      message: 'Invitation accepted.',
    };
  } catch (error) {
    // The one-Leader index fires if someone became Leader after the invite was sent.
    if (isUniqueViolation(error)) {
      logAcceptFailure('Team already has a leader', currentUser.email, invitation.organization.name);
      throw new AppError(409, 'CONFLICT', 'This team already has a leader. Ask an Admin for a new invitation.');
    }
    if (error instanceof AppError) logAcceptFailure(error.message, currentUser.email, invitation.organization.name);
    throw error;
  }
};
