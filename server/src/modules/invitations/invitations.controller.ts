import type { Request, Response, NextFunction } from 'express';
import * as invitationsService from './invitations.service.js';
import { createInvitationSchema, acceptInvitationSchema, invitationIdParamSchema } from './invitations.schemas.js';
import { AppError } from '../../shared/errors.js';

// A malformed id can never match a row; answer 404 like any unknown invitation.
const parseInvitationId = (raw: unknown): string => {
  const result = invitationIdParamSchema.safeParse(raw);
  if (!result.success) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
  return result.data;
};

export const create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createInvitationSchema.parse(req.body);
    const result = await invitationsService.createInvitation(req.org!, req.actor!.membershipId, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json(await invitationsService.listInvitations(req.org!.id));
  } catch (error) {
    next(error);
  }
};

export const resend = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInvitationId(req.params.id);
    res.status(200).json(await invitationsService.resendInvitation(req.org!, id));
  } catch (error) {
    next(error);
  }
};

export const revoke = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInvitationId(req.params.id);
    res.status(200).json(await invitationsService.revokeInvitation(req.org!.id, id));
  } catch (error) {
    next(error);
  }
};

export const accept = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = acceptInvitationSchema.parse(req.body);
    res.status(200).json(await invitationsService.acceptInvitation(req.user!, input));
  } catch (error) {
    next(error);
  }
};
