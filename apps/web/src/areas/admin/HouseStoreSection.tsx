import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { CardPhotoButton } from '../../shared/CardPhoto';
import { ITEM_CLASSES, itemClassLabel } from '../../shared/itemClasses';
import { dollarsToCents, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { Serial } from '../../shared/ui/Serial';
import { Button, EmptyState, Field, MoneyField, Panel, SkeletonTable, StatusBadge } from '../../shared/ui/primitives';
import { IconPlus, IconTag } from '../../shared/ui/icons';

interface HouseListingRow {
  id: string;
  code: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  photoRef: string | null;
  askingPrice: number;
  stock: number;
  status: 'active' | 'removed';
}

/**
 * Managing the Bault store: what the business sells, at what price, and how many
 * copies are left.
 *
 * The description is not marketing copy. It becomes the item record of every copy
 * sold, word for word, so it is asked for in the vault's catalogue shape — year,
 * set, card, number — and the photo is a catalogue scan named by its file stem.
 */
export function HouseStoreSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HouseListingRow[] | null>(null);
  const [typeClass, setTypeClass] = useState('trading_card');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('');
  const [photoRef, setPhotoRef] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');

  const load = useCallback(async () => {
    try {
      setRows(await api.get<HouseListingRow[]>('/marketplace/house/manage'));
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const cents = dollarsToCents(price);
  const copies = Number(stock);
  const ready = description.trim() !== '' && cents !== null && cents > 0 && Number.isInteger(copies) && copies >= 1;

  async function create() {
    if (!ready) return;
    try {
      await api.post('/marketplace/house/listings', {
        typeClass,
        description: description.trim(),
        conditionGrade: condition.trim() || undefined,
        photoRef: photoRef.trim() || undefined,
        askingPrice: cents,
        stock: copies,
      });
      onMsg(t('house.admin.created'));
      setDescription('');
      setCondition('');
      setPhotoRef('');
      setPrice('');
      setStock('1');
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function patch(row: HouseListingRow, body: Partial<Pick<HouseListingRow, 'stock' | 'status'>>) {
    try {
      await api.patch(`/marketplace/house/listings/${row.id}`, body);
      onMsg(t('house.admin.saved'));
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
      <Panel title={t('house.admin.new')} subtitle={t('house.admin.newSubtitle')}>
        <div className="stack stack--tight">
          <div className="form-grid">
            <Field label={t('warehouse.intake.typeClass')}>
              <select value={typeClass} onChange={(e) => setTypeClass(e.target.value)}>
                {ITEM_CLASSES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('warehouse.intake.description')} hint={t('house.admin.descriptionHint')}>
              <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label={t('warehouse.intake.condition')}>
              <input value={condition} maxLength={40} onChange={(e) => setCondition(e.target.value)} />
            </Field>
            <Field label={t('house.admin.photoRef')} hint={t('house.admin.photoRefHint')}>
              <input value={photoRef} onChange={(e) => setPhotoRef(e.target.value)} placeholder="SN-CL10-0005" dir="ltr" />
            </Field>
            <MoneyField label={t('house.admin.price')} value={price} onChange={setPrice} />
            <Field label={t('house.admin.stock')}>
              <input type="number" min={1} value={stock} onChange={(e) => setStock(e.target.value)} dir="ltr" />
            </Field>
          </div>
          <div className="row row--end">
            <Button variant="gold" icon={<IconPlus />} disabled={!ready} onClick={() => void create()}>
              {t('house.admin.create')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title={t('house.admin.heading', { count: rows?.length ?? 0 })} flush>
        {rows === null ? (
          <SkeletonTable rows={3} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('house.admin.empty')} icon={<IconTag />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('house.admin.col.code')}</th>
                  <th scope="col">{t('warehouse.intake.description')}</th>
                  <th scope="col">{t('house.admin.price')}</th>
                  <th scope="col">{t('house.admin.stock')}</th>
                  <th scope="col">{t('admin.col.status')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('house.admin.col.code')}>
                      <Serial value={row.code} />
                    </td>
                    <td data-label={t('warehouse.intake.description')}>
                      {row.photoRef && <CardPhotoButton serialNumber={row.photoRef} title={row.description} />}{' '}
                      {row.description}
                      <span className="card-sub"> · {itemClassLabel(t, row.typeClass)}</span>
                    </td>
                    <td data-label={t('house.admin.price')} dir="ltr">
                      {formatUsd(row.askingPrice)}
                    </td>
                    <td data-label={t('house.admin.stock')}>
                      <input
                        type="number"
                        min={0}
                        defaultValue={row.stock}
                        aria-label={t('house.admin.stockOf', { code: row.code })}
                        style={{ width: '5rem' }}
                        dir="ltr"
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (Number.isInteger(next) && next >= 0 && next !== row.stock) void patch(row, { stock: next });
                        }}
                      />
                    </td>
                    <td data-label={t('admin.col.status')}>
                      {row.status === 'removed' ? (
                        <StatusBadge>{t('house.admin.removed')}</StatusBadge>
                      ) : row.stock === 0 ? (
                        <StatusBadge tone="warning">{t('house.admin.soldOut')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('house.admin.onSale')}</StatusBadge>
                      )}
                    </td>
                    <td className="td-tight">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void patch(row, { status: row.status === 'active' ? 'removed' : 'active' })}
                      >
                        {row.status === 'active' ? t('house.admin.remove') : t('house.admin.restore')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
