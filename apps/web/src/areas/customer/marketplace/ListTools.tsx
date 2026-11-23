import { useId, useMemo, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { Field } from '../../../shared/ui/primitives';
import { IconSearch } from '../../../shared/ui/icons';

export const LIST_TOOLS_FROM = 4;

export interface SortOption<T> {
  key: string;
  label: MessageKey;
  compare: (a: T, b: T) => number;
}

export function useListView<T>(
  rows: readonly T[] | null,
  text: (row: T) => string,
  sorts: readonly SortOption<T>[],
) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(sorts[0]?.key ?? '');
  const shown = useMemo(() => {
    if (!rows) return null;
    const needle = query.trim().toLowerCase();
    const kept = needle ? rows.filter((row) => text(row).toLowerCase().includes(needle)) : [...rows];
    const order = sorts.find((s) => s.key === sort);
    return order ? kept.sort(order.compare) : kept;
  }, [rows, query, sort, sorts, text]);
  return { query, setQuery, sort, setSort, shown };
}

export function ListTools<T>({
  label,
  view,
  sorts,
  total,
  children,
}: {
  label: string;
  view: { query: string; setQuery: (v: string) => void; sort: string; setSort: (v: string) => void; shown: T[] | null };
  sorts: readonly SortOption<T>[];
  total: number;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const searchId = useId();
  const count = view.shown?.length ?? 0;
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      <div className="search field--grow">
        <IconSearch />
        <input
          id={searchId}
          type="search"
          placeholder={t('market.list.search')}
          aria-label={t('market.list.search')}
          value={view.query}
          onChange={(e) => view.setQuery(e.target.value)}
        />
      </div>
      {children}
      {sorts.length > 1 && (
        <Field label={t('market.filter.sort')} className="field--compact">
          <select value={view.sort} onChange={(e) => view.setSort(e.target.value)}>
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <span className="spacer" />
      <span className="vault-count" role="status">
        {count === total
          ? total === 1
            ? t('market.list.countOne')
            : t('market.list.count', { count: total })
          : t('market.list.countOf', { count, total })}
      </span>
    </div>
  );
}

export function byNewest<T>(at: (row: T) => string) {
  return (a: T, b: T) => at(b).localeCompare(at(a));
}

export function byNumber<T>(value: (row: T) => number, direction: 1 | -1) {
  return (a: T, b: T) => direction * (value(a) - value(b));
}
