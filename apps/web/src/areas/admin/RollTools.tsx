import { useId, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n';
import { Button, EmptyState, ErrorState, Field } from '../../shared/ui/primitives';
import { IconSearch } from '../../shared/ui/icons';

export function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalizeQuery(query);
  if (q === '') return true;
  return fields.some((field) => (field ?? '').toLocaleLowerCase().includes(q));
}

export interface RollSort<K extends string> {
  value: K;
  options: { key: K; label: string }[];
  onChange: (next: K) => void;
}

export function RollTools<K extends string>({
  label,
  query,
  onQuery,
  placeholder,
  sort,
  shown,
  total,
  children,
}: {
  label: string;
  query: string;
  onQuery: (next: string) => void;
  placeholder: string;
  sort?: RollSort<K>;
  shown: number;
  total: number;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const countId = useId();
  return (
    <div className="filter-bar" role="search" aria-label={label}>
      <div className="search">
        <IconSearch />
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-describedby={countId}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query !== '') {
              e.preventDefault();
              e.stopPropagation();
              onQuery('');
            }
          }}
        />
      </div>
      {children}
      {sort && (
        <Field label={t('admin.roll.sort')} className="field--compact">
          <select value={sort.value} onChange={(e) => sort.onChange(e.target.value as K)}>
            {sort.options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="hint" id={countId} aria-live="polite">
        {shown === total
          ? t('admin.roll.count', { total })
          : t('admin.roll.shown', { shown, total })}
      </p>
    </div>
  );
}

export function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      title={
        query.trim()
          ? t('admin.roll.noMatch', { query: query.trim() })
          : t('admin.roll.noMatchFilters')
      }
      text={t('admin.roll.noMatchText')}
      icon={<IconSearch />}
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          {t('admin.roll.clear')}
        </Button>
      }
    />
  );
}

export function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="panel-body">
      <ErrorState
        title={t('admin.roll.loadFailed')}
        message={message}
        onRetry={onRetry}
        retryLabel={t('ui.retry')}
      />
    </div>
  );
}
