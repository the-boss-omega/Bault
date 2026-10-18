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
  value: number;
  currency: string;
  billingTrigger: string;
  parameters: Record<string, unknown> | null;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
  note: string;
}

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
