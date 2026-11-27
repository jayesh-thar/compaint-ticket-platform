import type { Request, Response, NextFunction } from 'express';
import type { Organization, Membership } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../shared/errors.js';
import type { Actor } from '../shared/permissions.js';

export type { Actor };

declare global {
  namespace Express {
    interface Request {
      org?: Organization;
      membership?: Membership;
      actor?: Actor;
    }
  }
}

// Same error for "org does not exist" and "you are not an active member" (D-12),
// so nobody can probe which organizations exist.
const notFound = () => new AppError(404, 'NOT_FOUND', 'Organization not found.');

/**
 * Resolves `:slug`, loads the caller's ACTIVE membership, and builds `req.actor`.
 * Membership is checked on every request, so a removed member loses access on
 * their very next call without touching their session.
 */
export const requireOrgMember = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const slug = String(req.params.slug ?? '').toLowerCase();
    if (!slug) throw notFound();

    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) throw notFound();

    const membership = await prisma.membership.findFirst({
      where: { organizationId: org.id, userId: req.user.id, status: 'ACTIVE' },
      include: {
        teamMemberships: { select: { teamId: true, role: true } },
        ledCategories: { where: { archivedAt: null }, select: { id: true } },
      },
    });
    if (!membership) throw notFound();
    const { teamMemberships, ledCategories, ...membershipRow } = membership;

    req.org = org;
    req.membership = membershipRow;
    req.actor = {
      userId: req.user.id,
      organizationId: org.id,
      membershipId: membership.id,
      role: membership.role,
      teamIds: teamMemberships.map((t) => t.teamId),
      leadTeamIds: teamMemberships.filter((t) => t.role === 'LEADER').map((t) => t.teamId),
      leadCategoryIds: ledCategories.map((c) => c.id),
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.actor || req.actor.role !== 'ADMIN') {
    throw new AppError(403, 'FORBIDDEN', 'Only organization Admins can perform this action.');
  }
  next();
};
