import { dayKey } from './money';

/**
 * A register's rows in runs of one calendar day, in the order they were given (newest first, so that the
 * first day is the one nearest now). Each run has the key a heading can be named by and the row that opens it.
 */
export function inDays<T>(rows: readonly T[], at: (row: T) => string) {
  const days: Array<{ key: string; items: T[]; first: T }> = [];
  for (const row of rows) {
    const key = dayKey(at(row));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(row);
    else days.push({ key, items: [row], first: row });
  }
  return days;
}
