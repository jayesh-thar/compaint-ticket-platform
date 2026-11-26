import { Router } from 'express';
import * as orgsController from './orgs.controller.js';
import { requireAuth, requireVerified } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';

// Mounted at /api/v1/orgs
export const orgsRouter = Router();

orgsRouter.post('/', requireAuth, requireVerified, orgsController.createOrg);
orgsRouter.get('/:slug', requireAuth, requireOrgMember, orgsController.getOrg);
orgsRouter.patch('/:slug', requireAuth, requireOrgMember, requireAdmin, orgsController.updateOrg);

// Mounted at /api/v1/me  ->  GET /api/v1/me/orgs
export const meRouter = Router();
meRouter.get('/orgs', requireAuth, orgsController.getMyOrgs);
