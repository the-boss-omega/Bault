import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { bpsToPercent, formatUsd } from '../../../shared/money';
import { itemClassLabel } from '../../../shared/itemClasses';
import { percentOff, useViewerTier } from '../../../shared/tiers';
import { TierPrice } from '../../../shared/ui/TierPrice';
import { EmptyState, ErrorState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconReceipt, IconSearch } from '../../../shared/ui/icons';
import type { AccountTerms } from './FaqLegalPage';

interface PriceEntry {
  actionType: string;
  itemClass: string | null;
  description: string;
  model: 'fixed' | 'percentage';
  value: number;
  currency: string;
  billingTrigger: string;
  parameters: Record<string, unknown> | null;
  tierDiscounted?: boolean;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
  note: string;
}

const CASH_OUT = 'cash_out_fee';

function param(entry: PriceEntry, key: string): number | null {
  const raw = entry.parameters?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function asPercent(bps: number): string {
  return `${bpsToPercent(bps)}%`;
}

function storagePeriod(entry: PriceEntry) {
  const freeDays = param(entry, 'freeDays');
  const periodDays = param(entry, 'periodDays');
  const percentBps = param(entry, 'percentOfIntakeBps');
  return freeDays !== null && periodDays !== null && percentBps !== null
    ? { freeDays, periodDays, percentBps }
    : null;
}

function shown(entry: PriceEntry): boolean {
  return !(entry.model === 'fixed' && entry.value === 0 && !storagePeriod(entry));
}

function matches(t: TranslateFn, entry: PriceEntry, groupLabel: string, q: string): boolean {
  if (!q) return true;
  const hay = [entry.description, groupLabel, entry.itemClass ? itemClassLabel(t, entry.itemClass) : '']
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export function PriceListPanel() {
  const { t } = useI18n();
  const viewer = useViewerTier();
  const [list, setList] = useState<PriceList | null>(null);
  const [cashOut, setCashOut] = useState<AccountTerms['cashOut'] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');

  const load = useCallback(() => {
    setFailed(false);
    void api
      .get<PriceList>('/pricing/list')
      .then(setList)
      .catch(() => setFailed(true));
    void api
      .get<AccountTerms>('/content/account-terms')
      .then((terms) => setCashOut(terms?.cashOut ?? null))
      .catch(() => setCashOut(null));
  }, []);

  useEffect(load, [load]);

  const groupLabel = (key: string) => t(`prices.group.${key}` as MessageKey);
  const groups = (list?.groups ?? [])
    .map((g) => ({ ...g, entries: g.entries.filter(shown) }))
    .filter((g) => g.entries.length > 0);
  const visible = groups
    .filter((g) => group === 'all' || g.group === group)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => matches(t, e, groupLabel(g.group), q.trim())) }))
    .filter((g) => g.entries.length > 0);
  const found = visible.reduce((n, g) => n + g.entries.length, 0);

  function priceCell(e: PriceEntry) {
    if (e.actionType === CASH_OUT) {
      return cashOut ? (
        <span className="ltr-run">
          {t('legal.figures.cashOutValue', {
            smallPct: bpsToPercent(cashOut.smallBps),
            min: formatUsd(cashOut.smallMinimumMinor),
            band: formatUsd(cashOut.bandMinor),
            fixed: formatUsd(cashOut.largeFixedMinor),
            largePct: bpsToPercent(cashOut.largeBps),
          })}
        </span>
      ) : (
        <span className="hint">{t('prices.seeRule')}</span>
      );
    }
    const storage = storagePeriod(e);
    if (storage) {
      return <span>{t('prices.storagePrice', { percent: bpsToPercent(storage.percentBps) })}</span>;
    }
    return (
      <TierPrice
        listMinor={e.value}
        chargedMinor={e.tierDiscounted === false ? e.value : undefined}
        format={e.model === 'percentage' ? asPercent : formatUsd}
      />
    );
  }

  function whenCell(e: PriceEntry) {
    const storage = storagePeriod(e);
    const label = storage
      ? t('prices.trigger.storagePeriod', { free: storage.freeDays, period: storage.periodDays })
      : t(`prices.trigger.${e.billingTrigger}` as MessageKey);
    return (
      <StatusBadge tone="neutral" plain>
        {label}
      </StatusBadge>
    );
  }

  return (
    <>
      {failed && (
        <ErrorState
          title={t('prices.loadFailed')}
          message={t('prices.loadFailedText')}
          onRetry={load}
          retryLabel={t('ui.retry')}
        />
      )}
      <Panel title={t('prices.title')} subtitle={t('prices.subtitle')}>
        {list === null ? (
          !failed && <p className="hint">{t('grp.loading')}</p>
        ) : groups.length === 0 ? (
          <EmptyState title={t('prices.none')} text={t('prices.noneText')} icon={<IconReceipt />} />
        ) : (
          <>
            <p className="field-hint" data-testid="prices-tier">
              {viewer.tier === 'bronze' || viewer.discountBps <= 0
                ? t('prices.tierBronze')
                : t('prices.tierDiscount', {
                    tier: t(`tier.name.${viewer.tier}` as MessageKey),
                    percent: percentOff(viewer.discountBps),
                  })}{' '}
              <a href="#/tier">{t('prices.tierLink')}</a>
            </p>

            <div className="faq-controls">
              <div className="search search--wide">
                <IconSearch />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('prices.searchPlaceholder')}
                  aria-label={t('prices.searchLabel')}
                />
              </div>
              <div className="chip-row" role="group" aria-label={t('prices.groupLabel')}>
                {['all', ...groups.map((g) => g.group)].map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`chip${group === key ? ' is-on' : ''}`}
                    aria-pressed={group === key}
                    onClick={() => setGroup(key)}
                  >
                    {key === 'all' ? t('prices.groupAll') : groupLabel(key)}
                  </button>
                ))}
              </div>
            </div>

            <p className="sr-only" role="status">
              {t('prices.found', { count: found })}
            </p>

            {visible.length === 0 && (
              <EmptyState
                title={t('prices.noMatch')}
                text={t('prices.noMatchText')}
                icon={<IconSearch />}
              />
            )}

            {visible.map((g) => (
              <div key={g.group} style={{ marginBlockStart: 'var(--sp-5)' }}>
                <h3 className="drawer-heading">{groupLabel(g.group)}</h3>
                <div className="dt-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('prices.col.what')}</th>
                        <th scope="col">{t('prices.col.price')}</th>
                        <th scope="col">{t('prices.col.when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.entries.map((e) => (
                        <tr key={`${e.actionType}:${e.itemClass ?? ''}`}>
                          <td className="dt-primary">
                            <span className="ltr-run">{e.description}</span>
                          </td>
                          <td>{priceCell(e)}</td>
                          <td>{whenCell(e)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            <p className="field-hint stack-top">{t('prices.note')}</p>
          </>
        )}
      </Panel>
    </>
  );
}
