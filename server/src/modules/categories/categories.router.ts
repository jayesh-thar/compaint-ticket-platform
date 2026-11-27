import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireOrgMember, requireAdmin } from '../../middleware/org-member.js';
import { handle, parseIdParam, wantsArchived } from '../../shared/params.js';
import * as categories from './categories.service.js';

// Mounted at /api/v1/orgs/:slug/categories (any member reads; Admins change)
export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth, requireOrgMember);

categoriesRouter.get(
  '/',
  handle(200, (req) => categories.listCategories(req.org!.id, wantsArchived(req.query)))
);
categoriesRouter.post(
  '/',
  requireAdmin,
  handle(201, (req) => categories.createCategory(req.org!.id, categories.createCategorySchema.parse(req.body)))
);
categoriesRouter.patch(
  '/:categoryId',
  requireAdmin,
  handle(200, (req) =>
    categories.updateCategory(
      req.org!.id,
      parseIdParam(req.params.categoryId, 'Category'),
      categories.updateCategorySchema.parse(req.body)
    )
  )
);
