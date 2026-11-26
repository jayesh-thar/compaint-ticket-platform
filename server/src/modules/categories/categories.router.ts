import { Router } from 'express';
import * as categoriesService from './categories.service.js';
import { createCategorySchema, updateCategorySchema } from './categories.schemas.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';
import { handle, parseIdParam, wantsArchived } from '../../shared/params.js';

// Mounted at /api/v1/orgs/:slug/categories
export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth, requireOrgMember);

categoriesRouter.get(
  '/',
  handle(200, (req) => categoriesService.listCategories(req.org!.id, wantsArchived(req.query)))
);

categoriesRouter.post(
  '/',
  requireAdmin,
  handle(201, (req) => categoriesService.createCategory(req.org!.id, createCategorySchema.parse(req.body)))
);

categoriesRouter.patch(
  '/:id',
  requireAdmin,
  handle(200, (req) =>
    categoriesService.updateCategory(
      req.org!.id,
      parseIdParam(req.params.id, 'Category'),
      updateCategorySchema.parse(req.body)
    )
  )
);
