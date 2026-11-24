import { api } from './api';

export const PAGE_MAX = 500;

export async function getAllPages<T extends { id: string }>(path: string): Promise<T[]> {
  const join = path.includes('?') ? '&' : '?';
  const all: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: T[] = await api.get<T[]>(
      `${path}${join}limit=${PAGE_MAX}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    all.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE_MAX || !last) return all;
    cursor = last.id;
  }
}
