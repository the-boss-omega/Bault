import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { formatDateTime } from '../../shared/money';
import { useNavigation, useRoute } from '../../shared/routing';
import {
  TICKET_TONE,
  ticketCategoryLabel,
  ticketStatusLabel,
  type SupportQueueRow,
} from '../../shared/support';
import { ThreadDrawer } from '../customer/support/SupportPage';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { ListSearch, NoMatch, matchesQuery } from './ListTools';
import { IconAsk } from '../../shared/ui/icons';

export function SupportQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);

  const [rows, setRows] = useState<SupportQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [who, setWho] = useState<'all' | 'unassigned'>('all');

  const load = useCallback(async () => {
    try {
      setRows(await api.get<SupportQueueRow[]>('/support/queue'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows((prev) => prev ?? []);
    }
  }, []);

  const shown = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (who === 'all' || !r.assignedTo) &&
          matchesQuery(q, r.subject, r.code, r.customerUsername, ticketCategoryLabel(t, r.category)),
      ),
    [rows, q, who, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function take(row: SupportQueueRow) {
    try {
      await api.post(`/support/tickets/${row.id}/assign`);
      setNote(t('warehouse.support.taken', { code: row.code }));
      await load();
    } catch (e) {
      setNote(null);
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Panel title={t('supportQueue.title')} subtitle={t('supportQueue.subtitle')} flush>
        {(error || note) && (
          <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
            {error ? (
              <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />
            ) : (
              <SuccessNote>{note}</SuccessNote>
            )}
          </div>
        )}
        {rows !== null && rows.length > 0 && (
          <ListSearch
            value={q}
            onChange={setQ}
            label={t('warehouse.support.search')}
            placeholder={t('warehouse.support.searchPlaceholder')}
            shown={shown.length}
            total={rows.length}
          >
            <select
              className="vault-sort"
              value={who}
              aria-label={t('warehouse.support.filter')}
              onChange={(e) => setWho(e.target.value as 'all' | 'unassigned')}
            >
              <option value="all">{t('warehouse.support.filter.all')}</option>
              <option value="unassigned">{t('warehouse.support.filter.unassigned')}</option>
            </select>
          </ListSearch>
        )}

        {rows === null ? (
          <SkeletonTable rows={4} columns={5} />
        ) : rows.length === 0 ? (
          error ? null : (
            <EmptyState title={t('supportQueue.empty')} text={t('supportQueue.emptyText')} icon={<IconAsk />} />
          )
        ) : shown.length === 0 ? (
          <NoMatch
            onClear={() => {
              setQ('');
              setWho('all');
            }}
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('support.col.subject')}</th>
                  <th scope="col">{t('supportQueue.col.customer')}</th>
                  <th scope="col">{t('support.col.category')}</th>
                  <th scope="col">{t('support.col.status')}</th>
                  <th scope="col">{t('supportQueue.col.waiting')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('support.col.subject')} className="dt-primary">
                      <bdi dir="auto">{row.subject}</bdi>
                      <span className="dt-sub" dir="ltr">
                        {row.code}
                      </span>
                    </td>
                    <td data-label={t('supportQueue.col.customer')}>
                      <code dir="ltr">{row.customerUsername ?? '—'}</code>
                      {row.customerStatus === 'suspended' && (
                        <span className="dt-sub">
                          <StatusBadge tone="error" plain>
                            {t('supportQueue.customerSuspended')}
                          </StatusBadge>
                        </span>
                      )}
                    </td>
                    <td data-label={t('support.col.category')}>{ticketCategoryLabel(t, row.category)}</td>
                    <td data-label={t('support.col.status')}>
                      <StatusBadge tone={TICKET_TONE[row.status] ?? 'neutral'}>
                        {ticketStatusLabel(t, row.status, true)}
                      </StatusBadge>
                    </td>
                    <td data-label={t('supportQueue.col.waiting')}>{formatDateTime(row.lastMessageAt, locale)}</td>
                    <td className="td-tight">
                      <div className="actions">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openRecord('ticket', row.id)}
                        >
                          {t('support.open')}
                        </Button>
                        {!row.assignedTo && (
                          <Button size="sm" variant="secondary" onClick={() => void take(row)}>
                            {t('supportQueue.take')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {route.params.ticket && (
        <ThreadDrawer
          ticketId={route.params.ticket}
          staff
          onClose={() => closeRecord('ticket')}
          onChanged={async () => {
            await load();
            await onChanged?.();
          }}
        />
      )}
    </>
  );
}
