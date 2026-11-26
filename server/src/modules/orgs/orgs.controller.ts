import type { Request, Response, NextFunction } from 'express';
import * as orgsService from './orgs.service.js';
import { createOrgSchema, updateOrgSchema } from './orgs.schemas.js';

export const createOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createOrgSchema.parse(req.body);
    const result = await orgsService.createOrganization(req.user!.id, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const getMyOrgs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await orgsService.getMyOrganizations(req.user!.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getOrg = (req: Request, res: Response): void => {
  res.status(200).json(orgsService.getOrganization(req.org!, req.actor!));
};

export const updateOrg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = updateOrgSchema.parse(req.body);
    const result = await orgsService.updateOrganization(req.org!.id, req.actor!.role, input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
