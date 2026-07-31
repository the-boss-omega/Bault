import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { BarcodeLabel } from '../../../shared/Barcode';
import { useT } from '../../../shared/i18n';
import type { TranslateFn } from '../../../shared/i18n';

interface VaultItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  barcode: string;
  /** Where the item physically sits — every item has a bin (Requirement 10.3). */
  binBarcode: string | null;
  binZone: string | null;
  isLot: boolean;
  lotSize: number;
  lotBroken: boolean;
}

/** One entry of the item's complete history timeline (Requirement 13.2). */
interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
}

/** Styling only: lifecycle state → badge variant class. */
const STATE_BADGE: Record<string, string> = {
  stored: 'badge--stored',
  listed: 'badge--listed',
  sold: 'badge--sold',
  'on-hold': 'badge--hold',
  received: 'badge--info',
  shipped: 'badge--info',
  donated: 'badge--success',
  consigned: 'badge--info',
};

/**
 * Customer vault (T055). Lists the items the signed-in customer currently owns in
 * storage with incremental search, the bin each item is shelved in, a lot marker,
 * and a per-item history timeline. Calls GET /vault/items (owner-scoped in the API).
 */
export function VaultPage() {
  const t = useT();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<VaultItem | null>(null);

  // Incremental search-as-you-type: refetch on a debounce whenever the query
  // changes, so results update live from the partial query with no Enter/button.
  useEffect(() => {
    const handle = setTimeout(() => {
      void (async () => {
        try {
          setItems(await api.get<VaultItem[]>(`/vault/items${q ? `?q=${encodeURIComponent(q)}` : ''}`));
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      })();
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <section>
      <h2>{t('vault.title')}</h2>
      <div className="field-row">
        <input
          type="search"
          placeholder={t('vault.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <ul className="card-grid">
        {items.map((it) => (
          <li key={it.id} className="card">
            <CardPhotoThumb serialNumber={it.serialNumber} title={it.description || it.typeClass} />
            <h4 className="card-title">{it.typeClass}</h4>
            <p className="card-desc">{it.description || '—'}</p>
            <div className="card-meta">
              <span className={`badge ${STATE_BADGE[it.lifecycleState] ?? ''}`}>{it.lifecycleState}</span>
              <span>{t('vault.condition', { grade: it.conditionGrade ?? '—' })}</span>
              {it.isLot && !it.lotBroken && (
                <span className="badge badge--info">{t('vault.lotOf', { count: it.lotSize })}</span>
              )}
            </div>
            <div className="card-meta">
              {/* The bin is mandatory on intake, so it is always shown (Req 10.3). */}
              <span>
                {t('vault.bin', {
                  bin: it.binBarcode ? `${it.binBarcode} · ${it.binZone ?? ''}`.trim() : t('vault.noBin'),
                })}
              </span>
            </div>
            {/* The scannable label, plus a one-click print to the OS dialog. */}
            <BarcodeLabel value={it.barcode} caption={it.description || it.typeClass} />
            <div className="actions">
              <button className="btn btn--ghost" onClick={() => setHistoryFor(it)}>
                {t('vault.history')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {historyFor && <HistoryModal item={historyFor} onClose={() => setHistoryFor(null)} t={t} />}
    </section>
  );
}

/**
 * Everything that ever happened to one item (Requirement 13.2): intake, bin
 * transfers, corrections, offers, sales, shipments and disputes, newest first.
 */
function HistoryModal({ item, onClose, t }: { item: VaultItem; onClose: () => void; t: TranslateFn }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEvents(await api.get<TimelineEvent[]>(`/vault/items/${item.id}/timeline`));
      } catch (e) {
        setError((e as Error).message);
        setEvents([]);
      }
    })();
  }, [item.id]);

  // Esc closes; freeze background scrolling while the dialog is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('vault.historyTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h4>
            {t('vault.historyTitle')} — {item.description || item.typeClass}
          </h4>
          <button type="button" className="btn btn--ghost modal-close" aria-label={t('photo.close')} onClick={onClose}>
            ✕
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        {events === null ? (
          <p className="hint">{t('vault.historyLoading')}</p>
        ) : events.length === 0 ? (
          <p className="hint">{t('vault.historyEmpty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('vault.historyCol.date')}</th>
                  <th>{t('vault.historyCol.event')}</th>
                  <th>{t('vault.historyCol.details')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.at}-${i}`}>
                    <td dir="ltr">{e.at.slice(0, 10)}</td>
                    <td>
                      <span className="badge badge--info">{e.kind.replace(/_/g, ' ')}</span>
                    </td>
                    <td>{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
