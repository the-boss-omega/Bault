/**
 * Tiny API client. `credentials: 'include'` sends the httpOnly session cookie so
 * the browser stays authenticated without any token handling in JS (Principle IX).
 * Errors surface the uniform `{ error: { code, message } }` body from the API.
 *
 * Every failure is raised as an `ApiError` carrying a `kind`, so callers can tell
 * "the backend is not reachable" apart from "you are not signed in". There is
 * deliberately no automatic retry: a refused connection retried in a loop
 * hammers a dead port and hides the problem. The UI offers an explicit retry.
 */
const BASE = '/api/v1';

export type ApiErrorKind =
  /** The API could not be reached at all (dev proxy down, server not started, offline). */
  | 'unreachable'
  /** 401: no valid session. */
  | 'unauthenticated'
  /** 403: signed in, but not allowed. */
  | 'forbidden'
  /** 404: route or resource missing. */
  | 'not_found'
  /** 5xx: the backend itself failed. */
  | 'server'
  /** Any other 4xx (validation, conflict, …). */
  | 'client';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never reached a server. */
  readonly status: number;
  /** Machine-readable `error.code` from the API envelope, when present. */
  readonly code: string | undefined;

  constructor(kind: ApiErrorKind, status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** True when the failure means "no backend answered", not "the backend said no". */
export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'unreachable';
}

/**
 * i18n key describing a failure, or `null` when the API's own message is the
 * better thing to show (validation errors and conflicts are specific).
 * Returned as a plain string so this module stays free of the i18n catalogue;
 * the value is a real `MessageKey`, checked by TypeScript at every call site.
 */
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
  // The Vite dev proxy answers with this code when it cannot open a socket to
  // the API; treat it as "unreachable" rather than "the server errored".
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
    // `...options` first, so a caller's headers merge into the JSON content type
    // instead of replacing the whole headers object.
    res = await fetch(BASE + path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
  } catch (cause) {
    // fetch only rejects for transport-level failures: DNS, refused connection,
    // aborted request, offline browser. Never a bad HTTP status.
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
    // `||` not `??`: fetch reports an absent reason phrase as '', not null.
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
  /** For the PUT routes (`/notifications/preferences` and `.../channel`). */
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
};
