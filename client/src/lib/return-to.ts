/**
 * "Bring me back where I was after login" (architecture 12), surviving the
 * detour through registration and the email verification link (which opens in
 * a new tab). Only same-site paths are accepted, so a crafted link can never
 * send someone to another website after login (open redirect).
 */

const KEY = 'returnTo';

export const safePath = (raw: string | null | undefined): string | null =>
  raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\') ? raw : null;

export const rememberReturnTo = (raw: string | null | undefined) => {
  const path = safePath(raw);
  if (!path) return;
  try {
    localStorage.setItem(KEY, path);
  } catch {
    /* storage blocked: the query string still works in the same tab */
  }
};

/** The query-string value wins; otherwise a remembered one. Clears what it used. */
export const takeReturnTo = (fromQuery: string | null): string => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return safePath(fromQuery) ?? safePath(stored) ?? '/start';
};

export const loginUrl = (returnTo: string) => `/login?returnTo=${encodeURIComponent(returnTo)}`;
