import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { EmptyState, ErrorState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconReceipt } from '../../../shared/ui/icons';

interface PriceEntry {
  actionType: string;
  itemClass: string | null;
  description: string;
  model: 'fixed' | 'percentage';
  /** Cents for a fixed rule, basis points for a percentage one. */
  value: number;
  currency: string;
  billingTrigger: string;
  parameters: Record<string, unknown> | null;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
  note: string;
}

/**
 * What everything costs, before it is charged.
 *
 * `GET /pricing/rules` existed and returned every rule ever created, in the
 * shape the admin console edits, and nothing customer-facing called it — so a
 * collector could not find out what anything cost until it had been charged to
 * them. For a platform whose entire economics are per-item fees, that was a
 * straightforward omission.
 *
 * The grouping is the substance of the fix. A flat list of thirty action types
 * reads as a database dump because it is one; somebody wants to know what it
 * costs to send a card home, and `shipping`, `shipping_rush` and
 * `shipping_addon:gps_tracker` are three answers to that single question.
 */
export function PriceListPanel() {
  const { t } = useI18n();
  const [list, setList] = useState<PriceList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setList(await api.get<PriceList>('/pricing/list'));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  /**
   * A rule's price, in the units it is actually stated in.
   *
   * A percentage rule stores basis points and a fixed one stores cents.
   * Rendering both with `formatUsd` would turn 5% into "$5.00", which is the
   * kind of error a price list exists to prevent.
   */
  function priceOf(entry: PriceEntry): string {
    return entry.model === 'percentage'
      ? `${(entry.value / 100).toFixed(2)}%`
      : formatUsd(entry.value);
  }

  return (
    <>
      {error && <ErrorState message={error} />}
      <Panel title={t('prices.title')} subtitle={t('prices.subtitle')}>
        {list === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : list.groups.length === 0 ? (
          <EmptyState title={t('prices.none')} text={t('prices.noneText')} icon={<IconReceipt />} />
        ) : (
          <>
            <p className="field-hint">{list.note}</p>
            {list.groups.map((g) => (
              <div key={g.group} style={{ marginBlockStart: 'var(--sp-5)' }}>
                <h3 className="drawer-heading">{t(`prices.group.${g.group}` as MessageKey)}</h3>
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
                            {e.description}
                            {e.itemClass && (
                              <span className="dt-sub">
                                {t('prices.forClass', { itemClass: e.itemClass })}
                              </span>
                            )}
                          </td>
                          <td dir="ltr">
                            <strong>{priceOf(e)}</strong>
                          </td>
                          <td>
                            <StatusBadge tone="neutral" plain>
                              {t(`prices.trigger.${e.billingTrigger}` as MessageKey)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </Panel>
    </>
  );
}
