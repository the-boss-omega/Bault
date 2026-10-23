const BASE = '/api/v1';

export type ApiErrorKind =
  | 'unreachable'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'server'
  | 'client';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string | undefined;

  constructor(kind: ApiErrorKind, status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'unreachable';
}

export type ApiErrorMessageKey =
  | 'error.unreachable'
  | 'error.unauthenticated'
  | 'error.forbidden'
  | 'error.notFound'
  | 'error.server';

export function apiErrorKey(error: unknown): ApiErrorMessageKey | null {
  if (!(error instanceof ApiError)) return null;
  switch (error.kind) {
    case 'unreachable':
      return 'error.unreachable';
    case 'unauthenticated':
      return 'error.unauthenticated';
    case 'forbidden':
      return 'error.forbidden';
    case 'not_found':
      return 'error.notFound';
    case 'server':
      return 'error.server';
    default:
      return null;
  }
}

function kindForStatus(status: number, code: string | undefined): ApiErrorKind {
  if (code === 'api_unreachable') return 'unreachable';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'client';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError(
      'unreachable',
      0,
      cause instanceof Error && cause.message ? cause.message : 'Network request failed',
    );
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const envelope = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const code = envelope?.code;
    const message = envelope?.message || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(kindForStatus(res.status, code), res.status, message, code);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined, headers }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
};
