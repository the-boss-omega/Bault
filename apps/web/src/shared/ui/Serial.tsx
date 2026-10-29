import { Fragment, type ReactNode } from 'react';
import { CardSlab } from '../CardPhoto';
import { useT } from '../i18n';

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

/**
 * A card to choose among: the card in its case, then its serial and its name.
 * Inside a checkbox's label it is a tile (see "Choosing cards" in components.css);
 * on its own, in a list, it is a row. The photograph is decoration: the serial and
 * the name beside it are what the control is called.
 */
export function ItemPick({ serial, name }: { serial?: string | null; name: string }) {
  const t = useT();
  return (
    <span className="item-pick">
      {serial && (
        <span className="item-pick-art">
          <CardSlab as="span" serialNumber={serial} title={name} noneLabel={t('photo.none')} />
        </span>
      )}
      <span className="item-pick-text">
        {serial && <Serial value={serial} quiet />} <span className="item-pick-name ltr-run">{name}</span>
      </span>
    </span>
  );
}

/**
 * A code, as a code is written. One that is too long for its line breaks where it is made of parts
 * ("service_fee:" and "video_review"), and only inside a word when a part is longer than the line.
 */
export function Code({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`code-inline ${className}`.trim()} dir="ltr" translate="no">
      {(value ?? '').split(':').map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              :<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
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
