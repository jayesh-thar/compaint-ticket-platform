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

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/v1/${endpoint}`;

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
    throw new ClientApiError(response.status, errorData);
  }

  return data as T;
}
