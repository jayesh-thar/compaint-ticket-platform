import { z } from 'zod';

export const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'portal',
  'public',
  'auth',
  'me',
  'w',
  'o',
  'health',
  'static',
  'assets',
  'favicon',
  'robots',
  'sitemap',
  'orgs',
  'members',
  'invitations',
  'tickets',
  'dashboard',
]);

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const validateSlug = (slug: string): boolean => {
  if (slug.length < 3 || slug.length > 40) return false;
  if (!SLUG_REGEX.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return false;
  return true;
};

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Slug must be at least 3 characters')
  .max(40, 'Slug cannot exceed 40 characters')
  .refine((val) => SLUG_REGEX.test(val), {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens, and start/end with a letter or digit.',
  })
  .refine((val) => !RESERVED_SLUGS.has(val), {
    message: 'This slug is reserved and cannot be used.',
  });
