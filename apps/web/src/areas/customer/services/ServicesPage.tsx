import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useVaultItems } from '../../../shared/useVaultItems';
import { serviceStatusLabel, serviceTypeLabel } from '../../../shared/serviceLabels';
import { useT } from '../../../shared/i18n';

/** Styling only: service status → badge variant class. */
const STATUS_BADGE: Record<string, string> = {
  requested: 'badge--pending',
  in_progress: 'badge--accepted',
  completed: 'badge--done',
  cancelled: 'badge--denied',
};

interface MyRequest {
  id: string;
  type: string;
  status: string;
  itemId: string | null;
  createdAt: string;
  typeFields: Record<string, unknown> | null;
}

/**
 * Value-added services. Pick an item from your vault, order a service (billable),
 * and track ALL your requests below — pending → accepted → done (or denied).
 * Operators accept/deny and complete requests from the warehouse console.
 */
export function ServicesPage() {
  const t = useT();
  const { items, error, reload } = useVaultItems(true);
  const [itemId, setItemId] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [requests, setRequests] = useState<MyRequest[]>([]);

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await api.get<MyRequest[]>('/services/mine'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id);
  }, [items, itemId]);
  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    if (!itemId) {
      setStatus(t('services.selectItemFirst'));
      return;
    }
    try {
      await fn();
      setStatus(ok);
      await reload();
      await loadRequests();
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  async function donate() {
    const challenge = await api.post<{ confirmationToken: string }>('/services/donation', { itemId });
    await api.post('/services/donation/confirm', { confirmationToken: challenge.confirmationToken });
  }

  return (
    <section>
      <h2>{t('services.title')}</h2>
      <div className="card">
        <p>{t('services.pickItem')}</p>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">{t('services.pickItemOption')}</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.typeClass} — {i.description}
            </option>
          ))}
        </select>
        {items.length === 0 && <p className="hint">{t('services.noItems')}</p>}

        <div className="actions">
          <button className="btn btn--primary" disabled={!itemId} onClick={() => run(() => api.post('/services/photography', { itemId }), t('services.photographyRequested'))}>
            {t('services.photography')}
          </button>
          <button className="btn btn--primary" disabled={!itemId} onClick={() => run(() => api.post('/services/grading', { itemId }), t('services.gradingRequested'))}>
            {t('services.grading')}
          </button>
          <button className="btn btn--primary" disabled={!itemId} onClick={() => run(() => api.post('/services/consignment', { itemId, channel: 'eBay' }), t('services.consignmentRequested'))}>
            {t('services.consignment')}
          </button>
          <button className="btn btn--accent" disabled={!itemId} onClick={() => run(donate, t('services.donated'))}>{t('services.donation')}</button>
        </div>
      </div>

      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}

      <h3>{t('services.myRequests')}</h3>
      {requests.length === 0 ? (
        <p className="hint">{t('services.noRequests')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('services.colService')}</th>
                <th>{t('services.colStatus')}</th>
                <th>{t('services.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{serviceTypeLabel(t, r.type)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? ''}`}>
                      {serviceStatusLabel(t, r.status)}
                    </span>
                  </td>
                  <td dir="ltr">{r.createdAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
