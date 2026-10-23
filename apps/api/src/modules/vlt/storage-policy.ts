export interface StorageParameters {
  freeDays: number;
  periodDays: number;
  percentOfIntakeBps: number;
}

export const STANDARD_STORAGE: StorageParameters = {
  freeDays: 180,
  periodDays: 90,
  percentOfIntakeBps: 1_000,
};

export const OVERSIZED_STORAGE: StorageParameters = {
  freeDays: 90,
  periodDays: 90,
  percentOfIntakeBps: 10_000,
};

export function storageParameters(
  raw: unknown,
  fallback: StorageParameters = STANDARD_STORAGE,
): StorageParameters {
  const p = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown, dflt: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : dflt;
  return {
    freeDays: num(p.freeDays, fallback.freeDays),
    periodDays: Math.max(1, num(p.periodDays, fallback.periodDays)),
    percentOfIntakeBps: num(p.percentOfIntakeBps, fallback.percentOfIntakeBps),
  };
}

const DAY_MS = 86_400_000;

export function freeUntil(receivedAt: Date | string, params: StorageParameters): Date {
  const from = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  return new Date(from.getTime() + params.freeDays * DAY_MS);
}

export function nextChargeAt(
  receivedAt: Date | string,
  params: StorageParameters,
  periodsBilled: number,
  coveredUntil: Date | string | null = null,
): Date {
  const included = freeUntil(receivedAt, params).getTime();
  const cover = coveredUntil ? new Date(coveredUntil).getTime() : -Infinity;
  return new Date(Math.max(included, cover) + periodsBilled * params.periodDays * DAY_MS);
}

export function periodChargeMinor(intakeMinor: number, params: StorageParameters): number {
  return Math.max(1, Math.round((intakeMinor * params.percentOfIntakeBps) / 10_000));
}
