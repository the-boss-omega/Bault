import type { ReactNode } from 'react';

export function Serial({
  value,
  lead,
  quiet,
  className = '',
}: {
  value: string;
  lead?: boolean;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <span
      className={['serial', lead ? 'serial--lead' : '', quiet ? 'serial--quiet' : '', className]
        .filter(Boolean)
        .join(' ')}
      dir="ltr"
      translate="no"
    >
      {value}
    </span>
  );
}

export function ItemPick({ serial, name }: { serial?: string | null; name: string }) {
  return (
    <span>
      {serial && <Serial value={serial} quiet />} <span className="ltr-run">{name}</span>
    </span>
  );
}

export function Code({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`code-inline ${className}`.trim()} dir="ltr" translate="no">
      {value}
    </span>
  );
}

export function Amount({
  children,
  size,
  tone,
  what,
  className = '',
}: {
  children: ReactNode;
  size?: 'lead' | 'display';
  tone?: 'brass' | 'credit' | 'debit';
  what?: ReactNode;
  className?: string;
}) {
  const amount = (
    <span
      className={[
        'amount',
        size ? `amount--${size}` : '',
        tone ? `amount--${tone}` : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      dir="ltr"
    >
      {children}
    </span>
  );

  if (!what) return amount;
  return (
    <span className="amount-with">
      {amount} <span className="amount-for">· {what}</span>
    </span>
  );
}

export function Seal({
  children,
  icon,
  brass,
}: {
  children: ReactNode;
  icon?: ReactNode;
  brass?: boolean;
}) {
  return (
    <span className={brass ? 'seal seal--brass' : 'seal'}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

export function LtrRun({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`ltr-run ${className}`.trim()}>{children}</span>;
}
