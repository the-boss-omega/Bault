import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n';
import { scrollBehavior } from '../../shared/ui/motionPreference';
import { Button, EmptyState } from '../../shared/ui/primitives';
import { IconSearch } from '../../shared/ui/icons';

export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

export function ListSearch({
  value,
  onChange,
  label,
  placeholder,
  shown,
  total,
  children,
  inset = true,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  shown: number;
  total: number;
  children?: ReactNode;
  inset?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="vault-command" style={inset ? { padding: 'var(--sp-4) var(--sp-6) 0' } : undefined}>
      <div className="vault-search">
        <IconSearch />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
      {children}
      <span className="spacer" />
      <span className="vault-count" role="status">
        {shown === total
          ? t('warehouse.list.count', { count: total })
          : t('warehouse.list.countOf', { shown, total })}
      </span>
    </div>
  );
}

export function NoMatch({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t('warehouse.list.noMatch')}
      text={t('warehouse.list.noMatchText')}
      icon={<IconSearch />}
      action={
        <Button size="sm" onClick={onClear}>
          {t('warehouse.list.clear')}
        </Button>
      }
    />
  );
}

export function SectionJump({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const { t } = useI18n();
  return (
    <nav className="row" aria-label={t('warehouse.jump.label')} style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
      <span className="field-hint">{t('warehouse.jump.label')}</span>
      {sections.map((s) => (
        <Button
          key={s.id}
          size="sm"
          variant="ghost"
          onClick={() => {
            const target = document.getElementById(s.id);
            target?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
            const heading = target?.querySelector<HTMLElement>('h2, h3');
            if (heading) {
              heading.tabIndex = -1;
              heading.focus({ preventScroll: true });
            }
          }}
        >
          {s.label}
        </Button>
      ))}
    </nav>
  );
}
