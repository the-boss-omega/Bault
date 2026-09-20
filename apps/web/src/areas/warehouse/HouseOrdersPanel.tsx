import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { BarcodeLabel, BarcodePrintAllButton } from '../../shared/Barcode';
import { CardPhotoThumb } from '../../shared/CardPhoto';
import { formatDate } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Serial } from '../../shared/ui/Serial';
import { Button, EmptyState, ErrorState, Field, Panel, SuccessNote } from '../../shared/ui/primitives';
import type { StowSuggestion } from './IntakeBench';
import { IconBox } from '../../shared/ui/icons';

interface HouseOrderRow {
  id: string;
  code: string;
  createdAt: string;
  itemId: string;
  serialNumber: string;
  barcode: string;
  description: string;
  conditionGrade: string | null;
  photoRef: string | null;
  listingCode: string;
  buyerUsername: string | null;
}

/**
 * Cards sold from the Bault store, still in the store's box.
 *
 * They are already on the record — the sale minted each one a serial and a
 * barcode and gave it to its buyer — so there is nothing to type here. The work
 * is physical: take a copy of the product out of stock, print its label, stick it
 * on, photograph that copy if there is time, and put it on a shelf. Printing all
 * the waiting labels is one job, for the same reason it is on the intake bench.
 */
export function HouseOrdersPanel({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [orders, setOrders] = useState<HouseOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Where the last card went. The row vanishes once shelved, so it is said here. */
  const [done, setDone] = useState<string | null>(null);
  /**
   * The shelf auto-stow will use, shown BEFORE the press. It used to pick one
   * silently and name it only in a log at the foot of the page, so the operator
   * holding the card did not know which aisle to walk to.
   */
  const [suggestion, setSuggestion] = useState<StowSuggestion | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, next] = await Promise.all([
        api.get<HouseOrderRow[]>('/marketplace/house/orders/queue'),
        api.get<StowSuggestion>('/custody/bins/suggest').catch(() => null),
      ]);
      setOrders(queue);
      setSuggestion(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title={t('house.queue.title', { count: orders.length })}
      subtitle={t('house.queue.subtitle')}
      tools={
        <BarcodePrintAllButton
          labels={orders.map((o) => ({ value: o.barcode, caption: o.description || o.barcode }))}
          className="btn btn--secondary btn--sm"
        />
      }
    >
      {error && <ErrorState message={error} />}
      {done && !error && <SuccessNote>{done}</SuccessNote>}
      {orders.length === 0 ? (
        <EmptyState title={t('house.queue.empty')} icon={<IconBox />} />
      ) : (
        <ul className="parcel-rows">
          {orders.map((o) => (
            <HouseOrderRowView
              key={o.id}
              order={o}
              when={formatDate(o.createdAt, locale)}
              suggestion={suggestion}
              onStowed={async (line) => {
                onLog(line);
                setDone(line);
                await load();
              }}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HouseOrderRowView({
  order,
  when,
  suggestion,
  onStowed,
  onError,
}: {
  order: HouseOrderRow;
  when: string;
  suggestion: StowSuggestion | null;
  onStowed: (line: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [bin, setBin] = useState('');
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [busy, setBusy] = useState(false);

  async function stow() {
    setBusy(true);
    try {
      const res = await api.post<{ serialNumber: string; binBarcode: string | null }>(
        `/marketplace/house/orders/${order.id}/stow`,
        bin.trim()
          ? { binId: bin.trim(), photoKeys: photoKeys(photos) }
          : { autoStow: true, photoKeys: photoKeys(photos) },
      );
      onError(null);
      await onStowed(t('house.queue.stowed', { serial: res.serialNumber, bin: res.binBarcode ?? '—' }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="parcel-row">
      <div className="row">
        <div style={{ width: 72 }}>
          <CardPhotoThumb serialNumber={order.photoRef ?? ''} title={order.description} />
        </div>
        <div className="stack stack--tight" style={{ flex: '1 1 260px' }}>
          <strong>
            <Serial value={order.serialNumber} />
          </strong>
          <span>{order.description}</span>
          <span className="field-hint">
            {t('house.queue.meta', {
              buyer: order.buyerUsername ?? '—',
              product: order.listingCode,
              order: order.code,
              when,
            })}
          </span>
        </div>
        <BarcodeLabel value={order.barcode} caption={order.description || order.barcode} />
      </div>

      <div className="form-grid">
        <Field
          label={t('warehouse.intake.stowScan')}
          hint={
            !bin.trim() && suggestion
              ? t('house.queue.willGoTo', { bin: suggestion.serialNumber, zone: suggestion.zone })
              : t('house.queue.binHint')
          }
        >
          <input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="BIN-XXXXXXXX" dir="ltr" />
        </Field>
      </div>

      <PhotoInput
        purpose="item_intake"
        value={photos}
        onChange={setPhotos}
        label={t('warehouse.intake.photos')}
        hint={t('house.queue.photosHint')}
      />

      <div className="row row--end">
        <Button variant="gold" icon={<IconBox />} loading={busy} disabled={busy} onClick={() => void stow()}>
          {t('house.queue.stow')}
        </Button>
      </div>
    </li>
  );
}
