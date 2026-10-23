import { AppError } from './errors/app-error';

export function pageLimit(raw: unknown, opts: { max: number; fallback: number }): number {
  if (raw === undefined || raw === '') return opts.fallback;
  if (typeof raw !== 'string' || !/^[0-9]{1,9}$/.test(raw)) {
    throw AppError.validation('limit must be a whole number of at least 1', { field: 'limit' });
  }
  const n = Number(raw);
  if (n < 1) throw AppError.validation('limit must be a whole number of at least 1', { field: 'limit' });
  return Math.min(n, opts.max);
}

export function clampLimit(n: number | undefined, opts: { max: number; fallback: number }): number {
  if (n === undefined || !Number.isFinite(n)) return opts.fallback;
  return Math.min(Math.max(1, Math.trunc(n)), opts.max);
}
