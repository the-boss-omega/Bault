import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { BarcodeLabel, BarcodePrintAllButton } from '../../shared/Barcode';
import { CardPhotoThumb } from '../../shared/CardPhoto';
import { formatDate } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Serial } from '../../shared/ui/Serial';
import { Button, EmptyState, Panel, ScanField, StatusBadge } from '../../shared/ui/primitives';
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

export function HouseOrdersPanel({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [orders, setOrders] = useState<HouseOrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await api.get<HouseOrderRow[]>('/marketplace/house/orders/queue'));
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
          variant="secondary"
          size="sm"
        />
      }
    >
      {error && <p className="field-error">{error}</p>}
      {orders.length === 0 ? (
        <EmptyState title={t('house.queue.empty')} icon={<IconBox />} />
      ) : (
        <ul className="tag-grid">
          {orders.map((o) => (
            <HouseOrderRowView
              key={o.id}
              order={o}
              when={formatDate(o.createdAt, locale)}
              onStowed={async (line) => {
                onLog(line);
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
  onStowed,
  onError,
}: {
  order: HouseOrderRow;
  when: string;
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
      await onStowed(
        t('house.queue.stowed', { serial: res.serialNumber, bin: res.binBarcode ?? '—' }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tag-item tag-item--order">
      {/* A sale is a tag: its number, the card sold, who bought it and from which listing; under it, the label to stick on it and where it goes. */}
      <DrawerTag
        item
        art={<CardPhotoThumb serialNumber={order.photoRef ?? ''} title={order.description} />}
        kicker={order.code}
        title={<bdi dir="auto">{order.description}</bdi>}
        lines={[
          { label: t('bench.serial'), value: <Serial value={order.serialNumber} /> },
          {
            label: t('bench.buyer'),
            value: order.buyerUsername ? <bdi dir="ltr">@{order.buyerUsername}</bdi> : '—',
          },
          { label: t('bench.listing'), value: <bdi dir="ltr">{order.listingCode}</bdi> },
          { label: t('bench.placed'), value: when },
        ]}
        status={<StatusBadge tone="warning">{t('bench.kicker.storeSale')}</StatusBadge>}
      />

      <div className="stack stack--tight tag-bench">
        <BarcodeLabel value={order.barcode} caption={order.description || order.barcode} />

        <ScanField
          label={t('warehouse.intake.stowScan')}
          hint={t('house.queue.binHint')}
          value={bin}
          onChange={setBin}
          onScan={() => void stow()}
          placeholder="BIN-XXXXXXXX"
        />

        <PhotoInput
          purpose="item_intake"
          value={photos}
          onChange={setPhotos}
          label={t('warehouse.intake.photos')}
          hint={t('house.queue.photosHint')}
        />

        <div className="row">
          <Button
            variant="primary"
            icon={<IconBox />}
            loading={busy}
            disabled={busy}
            onClick={() => void stow()}
          >
            {t('house.queue.stow')}
          </Button>
        </div>
      </div>
    </li>
  );
}
