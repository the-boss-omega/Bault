import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { formatDateTime } from '../../shared/money';
import { useNavigation, useRoute } from '../../shared/routing';
import { loadProfile } from '../../shared/session';
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
} from '../../shared/ui/primitives';
import { IconAsk } from '../../shared/ui/icons';

/**
 * The staff side of the helpdesk.
 *
 * Ordered LONGEST-WAITING FIRST, which is the API's ordering and not a client
 * preference: a support queue sorted newest-first is one where whoever has been
 * ignored longest keeps being ignored.
 *
 * The thread itself is the same component the customer sees — deliberately. Two
 * renderings of one conversation is how a support tool ends up showing the two
 * sides different things.
 */
export function SupportQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);

  const [rows, setRows] = useState<SupportQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Who is looking, so a taken ticket can say whether it is theirs. */
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    void loadProfile()
      .then((p) => setMeId(p.id))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<SupportQueueRow[]>('/support/queue'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function take(id: string) {
    try {
      await api.post(`/support/tickets/${id}/assign`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Panel title={t('supportQueue.title')} subtitle={t('supportQueue.subtitle')} flush>
        {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

        {rows === null ? (
          <SkeletonTable rows={4} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('supportQueue.empty')} text={t('supportQueue.emptyText')} icon={<IconAsk />} />
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
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="dt-primary" data-label={t('support.col.subject')}>
                      {row.subject}
                      <span className="dt-sub" dir="ltr">
                        {row.code}
                      </span>
                    </td>
                    <td data-label={t('supportQueue.col.customer')}>
                      <code dir="ltr">{row.customerUsername ? `@${row.customerUsername}` : '—'}</code>
                      {/* A locked-out customer asking about being locked out is
                          the ticket most likely to be urgent and least likely to
                          be obvious from the subject line. */}
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
                      {/* Taken, and by whom: "Take" used to leave no trace, so
                          two operators could both answer the same customer. */}
                      {row.assignedTo && (
                        <span className="dt-sub">
                          {row.assignedTo === meId ? t('supportQueue.takenByYou') : t('supportQueue.takenByColleague')}
                        </span>
                      )}
                    </td>
                    <td data-label={t('supportQueue.col.waiting')} dir="ltr">
                      {formatDateTime(row.lastMessageAt, locale)}
                    </td>
                    <td className="td-tight td-actions">
                      <div className="actions">
                        <Button size="sm" variant="gold" onClick={() => openRecord('ticket', row.id)}>
                          {t('support.open')}
                        </Button>
                        {!row.assignedTo && (
                          <Button size="sm" variant="secondary" onClick={() => void take(row.id)}>
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
