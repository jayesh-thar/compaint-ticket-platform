export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  requestId?: string;
}

export class ClientApiError extends Error {
  public readonly code: string;
  public readonly fields?: Record<string, string>;
  public readonly status: number;
  public readonly requestId?: string;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ClientApiError';
    this.status = status;
    this.code = error.code;
    this.fields = error.fields;
    this.requestId = error.requestId;
  }
}

/**
 * Every server route lives under /api/v1 (and Vite only proxies /api in dev),
 * so callers pass the short path ('/auth/me', '/orgs/acme') and we prefix it here.
 */
export const toApiUrl = (endpoint: string): string => {
  if (endpoint.startsWith('/api/')) return endpoint;
  return `/api/v1${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
};

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = toApiUrl(endpoint);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include', // sends and receives first-party sid cookies
  });

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorData = data?.error || {
      code: 'INTERNAL_ERROR',
      message: response.statusText || 'An unexpected error occurred.',
    };

    // Session expired mid-work: send the user to login and bring them back here
    // afterwards. Auth endpoints handle 401 themselves (e.g. "wrong password").
    if (response.status === 401 && !url.startsWith('/api/v1/auth/')) {
      const here = window.location.pathname + window.location.search;
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign(`/login?returnTo=${encodeURIComponent(here)}`);
      }
    }

    throw new ClientApiError(response.status, errorData);
  }

  return data as T;
}
