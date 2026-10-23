import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../shared/api';
import { formatDateTime } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { Button, EmptyState, Panel, SkeletonTable } from '../../shared/ui/primitives';
import { IconInbox } from '../../shared/ui/icons';

export interface ParkedMessage {
  id: string;
  eventType: string;
  aggregateType: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  payloadKeys: string[];
}

export function OutboxSection({
  onMsg,
  onError,
  onCount,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
  onCount?: (n: number) => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ParkedMessage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<ParkedMessage[]>('/admin/outbox/parked');
      setRows(list);
      onCount?.(list.length);
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requeue(m: ParkedMessage) {
    setBusy(m.id);
    try {
      await api.post(`/admin/outbox/${m.id}/requeue`);
      onMsg(t('admin.outbox.requeued'));
    } catch (e) {
      onError(e instanceof ApiError && e.code === 'outbox_not_parked' ? t('admin.outbox.notParked') : (e as Error).message);
    } finally {
      setBusy(null);
      await load();
    }
  }

  return (
    <Panel
      title={t('admin.outbox.title', { count: rows?.length ?? 0 })}
      subtitle={t('admin.outbox.subtitle')}
      flush
    >
      {rows === null ? (
        <SkeletonTable rows={3} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.outbox.empty')} icon={<IconInbox />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.outbox.col.event')}</th>
                <th scope="col" className="td-end">
                  {t('admin.outbox.col.attempts')}
                </th>
                <th scope="col">{t('admin.outbox.col.error')}</th>
                <th scope="col">{t('admin.outbox.col.created')}</th>
                <th scope="col">{t('admin.outbox.col.lastAttempt')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="is-attention">
                  <td data-label={t('admin.outbox.col.event')}>
                    <code className="code-inline">{m.eventType}</code>
                    <span className="dt-sub" dir="ltr" title={t('admin.outbox.col.fields')}>
                      {[m.aggregateType, ...m.payloadKeys].join(' · ')}
                    </span>
                  </td>
                  <td data-label={t('admin.outbox.col.attempts')} className="td-end num">
                    {m.attempts}
                  </td>
                  <td data-label={t('admin.outbox.col.error')}>
                    <span className="code-inline" dir="ltr">
                      {m.lastError ?? '—'}
                    </span>
                  </td>
                  <td data-label={t('admin.outbox.col.created')}>
                    <span dir="ltr">{formatDateTime(m.createdAt, locale)}</span>
                  </td>
                  <td data-label={t('admin.outbox.col.lastAttempt')}>
                    <span dir="ltr">{m.lastAttemptAt ? formatDateTime(m.lastAttemptAt, locale) : '—'}</span>
                  </td>
                  <td className="td-tight">
                    <Button
                      size="sm"
                      loading={busy === m.id}
                      disabled={busy !== null && busy !== m.id}
                      aria-label={t('admin.outbox.requeueLabel', { event: m.eventType })}
                      onClick={() => void requeue(m)}
                    >
                      {t('admin.outbox.requeue')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
