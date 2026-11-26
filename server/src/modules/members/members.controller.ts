import type { Request, Response, NextFunction } from 'express';
import * as membersService from './members.service.js';
import { membershipIdParamSchema, updateMemberRoleSchema } from './members.schemas.js';
import { AppError } from '../../shared/errors.js';

// A malformed id can never match a row; answer 404 like any other unknown member.
const parseMembershipId = (raw: unknown): string => {
  const result = membershipIdParamSchema.safeParse(raw);
  if (!result.success) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
  return result.data;
};

export const getMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json(await membersService.listMembers(req.org!.id));
  } catch (error) {
    next(error);
  }
};

export const updateRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const membershipId = parseMembershipId(req.params.membershipId);
    const input = updateMemberRoleSchema.parse(req.body);
    res.status(200).json(await membersService.updateMemberRole(req.org!.id, membershipId, input));
  } catch (error) {
    next(error);
  }
};

export const deleteMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const membershipId = parseMembershipId(req.params.membershipId);
    res.status(200).json(await membersService.removeMember(req.org!.id, membershipId));
  } catch (error) {
    next(error);
  }
};
