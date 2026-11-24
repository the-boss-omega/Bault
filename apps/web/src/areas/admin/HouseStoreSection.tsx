import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../../shared/api';
import { CardPhotoThumb } from '../../shared/CardPhoto';
import { useDebounced } from '../../shared/hooks';
import { ITEM_CLASSES, itemClassLabel } from '../../shared/itemClasses';
import { dollarsToCents, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Serial } from '../../shared/ui/Serial';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  MoneyField,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { LoadFailure, NoMatch, RollTools, matchesQuery } from './RollTools';
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

const quiet = <span className="drawer-tag-quiet">—</span>;

type HouseSort = 'newest' | 'name' | 'priceHigh' | 'priceLow' | 'stockLow';
type HouseFilter = 'all' | 'onSale' | 'soldOut' | 'removed';

const standing = (row: HouseListingRow): Exclude<HouseFilter, 'all'> =>
  row.status === 'removed' ? 'removed' : row.stock === 0 ? 'soldOut' : 'onSale';

type Notice = { ok: boolean; text: string };

export function HouseStoreSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HouseListingRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HouseFilter>('all');
  const [sort, setSort] = useState<HouseSort>('newest');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows(await api.get<HouseListingRow[]>('/marketplace/house/manage'));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(
    row: HouseListingRow,
    body: Partial<Pick<HouseListingRow, 'stock' | 'status'>> & { expectedStock?: number },
  ) {
    let notice: Notice;
    try {
      await api.patch(`/marketplace/house/listings/${row.id}`, body);
      const text =
        body.status === 'removed'
          ? t('admin.house.removedDone', { code: row.code })
          : body.status === 'active'
            ? t('admin.house.restoredDone', { code: row.code })
            : t('admin.house.stockDone', { code: row.code, count: body.stock ?? row.stock });
      onMsg(text);
      notice = { ok: true, text };
    } catch (e) {
      notice = { ok: false, text: (e as Error).message };
      onError((e as Error).message);
    }
    setNotices((all) => ({ ...all, [row.id]: notice }));
    await load();
  }

  const shown = useMemo(() => {
    const list = (rows ?? []).filter(
      (r) =>
        (filter === 'all' || standing(r) === filter) &&
        matchesQuery(query, r.code, r.description, r.conditionGrade, r.photoRef),
    );
    if (sort === 'newest') return list;
    return [...list].sort((a, b) =>
      sort === 'name'
        ? a.description.localeCompare(b.description)
        : sort === 'priceHigh'
          ? b.askingPrice - a.askingPrice
          : sort === 'priceLow'
            ? a.askingPrice - b.askingPrice
            : a.stock - b.stock,
    );
  }, [rows, query, filter, sort]);

  return (
    <>
      <NewProduct onMsg={onMsg} onError={onError} onAdded={load} />

      <Panel title={t('house.admin.heading', { count: rows?.length ?? 0 })}>
        {loadError ? (
          <LoadFailure message={loadError} onRetry={() => void load()} />
        ) : rows === null ? (
          <SkeletonTable rows={3} columns={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('house.admin.empty')}
            text={t('admin.house.emptyText')}
            icon={<IconTag />}
          />
        ) : (
          <>
            <RollTools
              label={t('admin.house.tools')}
              query={query}
              onQuery={setQuery}
              placeholder={t('admin.house.search')}
              shown={shown.length}
              total={rows.length}
              sort={{
                value: sort,
                onChange: setSort,
                options: [
                  { key: 'newest', label: t('admin.house.sort.newest') },
                  { key: 'name', label: t('admin.house.sort.name') },
                  { key: 'priceHigh', label: t('admin.house.sort.priceHigh') },
                  { key: 'priceLow', label: t('admin.house.sort.priceLow') },
                  { key: 'stockLow', label: t('admin.house.sort.stockLow') },
                ],
              }}
            >
              <Field label={t('admin.house.filterStatus')} className="field--compact">
                <select value={filter} onChange={(e) => setFilter(e.target.value as HouseFilter)}>
                  <option value="all">{t('admin.requests.filterAll')}</option>
                  <option value="onSale">{t('house.admin.onSale')}</option>
                  <option value="soldOut">{t('house.admin.soldOut')}</option>
                  <option value="removed">{t('house.admin.removed')}</option>
                </select>
              </Field>
            </RollTools>
            {shown.length === 0 ? (
              <NoMatch
                query={query}
                onClear={() => {
                  setQuery('');
                  setFilter('all');
                }}
              />
            ) : (
              <ul className="tag-grid">
                {shown.map((row) => (
                  // A new stock is a new tag: what the server now says replaces what was being typed.
                  <ProductTag
                    key={`${row.id}:${row.stock}:${row.status}`}
                    row={row}
                    notice={notices[row.id] ?? null}
                    onPatch={patch}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * A product to be added to the store, with the product as buyers will see it beside its fields: the card in its
 * case, the price, what it is and how many there are, written as they are typed. Its code is the store's to give.
 */
function NewProduct({
  onMsg,
  onError,
  onAdded,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
  onAdded: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [typeClass, setTypeClass] = useState('trading_card');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('');
  const [photoRef, setPhotoRef] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The photograph is looked for by its name once the name has stopped changing, not for each letter of it.
  const photo = useDebounced(photoRef.trim());

  const cents = dollarsToCents(price);
  const copies = Number(stock);
  const wholeCopies = stock.trim() !== '' && Number.isInteger(copies) && copies >= 1;
  const ready = description.trim() !== '' && cents !== null && cents > 0 && wholeCopies;

  const priceError =
    (price.trim() !== '' || tried) && (cents === null || cents <= 0)
      ? t('admin.house.priceInvalid')
      : undefined;

  async function create() {
    setTried(true);
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await api.post<{ code?: string } | null>('/marketplace/house/listings', {
        typeClass,
        description: description.trim(),
        conditionGrade: condition.trim() || undefined,
        photoRef: photoRef.trim() || undefined,
        askingPrice: cents,
        stock: copies,
      });
      const text = created?.code
        ? t('admin.house.createdAs', { code: created.code })
        : t('house.admin.created');
      onMsg(text);
      setNotice({ ok: true, text });
      setTried(false);
      setDescription('');
      setCondition('');
      setPhotoRef('');
      setPrice('');
      setStock('1');
      await onAdded();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('house.admin.new')} subtitle={t('house.admin.newSubtitle')}>
      <div className="request-form">
        <div className="stack stack--tight request-form-fields">
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
            <Field
              label={t('warehouse.intake.description')}
              hint={t('house.admin.descriptionHint')}
            >
              <input
                value={description}
                maxLength={300}
                dir="auto"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label={t('warehouse.intake.condition')}>
              <input
                value={condition}
                maxLength={40}
                dir="auto"
                onChange={(e) => setCondition(e.target.value)}
              />
            </Field>
            <Field label={t('house.admin.photoRef')} hint={t('house.admin.photoRefHint')}>
              <input
                value={photoRef}
                onChange={(e) => setPhotoRef(e.target.value)}
                placeholder="SN-CL10-0005"
                spellCheck={false}
                autoComplete="off"
                dir="ltr"
              />
            </Field>
            <MoneyField
              label={t('house.admin.price')}
              value={price}
              onChange={setPrice}
              error={priceError}
            />
            <Field
              label={t('house.admin.stock')}
              error={
                stock.trim() !== '' && !wholeCopies ? t('house.admin.stockInvalid') : undefined
              }
            >
              <input
                type="number"
                min={1}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                aria-invalid={stock.trim() !== '' && !wholeCopies}
                dir="ltr"
              />
            </Field>
          </div>
        </div>

        {/* The product as it will stand in the store: the card in its case, the price, what it is, how many. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('house.admin.product')}
            art={
              <CardPhotoThumb
                serialNumber={photo}
                title={description.trim() || t('warehouse.intake.description')}
                decorative
              />
            }
            title={
              description.trim() ? (
                <bdi dir="auto">{description.trim()}</bdi>
              ) : (
                <span className="drawer-tag-quiet">{t('warehouse.intake.description')}</span>
              )
            }
            amount={cents !== null && cents > 0 ? formatUsd(cents) : '—'}
            lines={[
              {
                label: t('house.admin.col.code'),
                value: <span className="drawer-tag-quiet">{t('house.admin.codeNext')}</span>,
              },
              {
                label: t('warehouse.intake.condition'),
                value: condition.trim() ? <bdi dir="auto">{condition.trim()}</bdi> : quiet,
              },
              { label: t('warehouse.intake.typeClass'), value: itemClassLabel(t, typeClass) },
              {
                label: t('house.admin.stock'),
                value: wholeCopies ? t('house.inStock', { count: copies }) : quiet,
              },
            ]}
            status={<StatusBadge tone="success">{t('house.admin.onSale')}</StatusBadge>}
          />
        </aside>

        <div className="row request-form-actions">
          <Button
            variant="primary"
            icon={<IconPlus />}
            loading={busy}
            disabled={!ready}
            onClick={() => void create()}
          >
            {t('house.admin.create')}
          </Button>
          {!ready && !busy && <span className="hint">{t('admin.house.missing')}</span>}
        </div>
        {notice &&
          (notice.ok ? (
            <SuccessNote>{notice.text}</SuccessNote>
          ) : (
            <ErrorState message={notice.text} />
          ))}
      </div>
    </Panel>
  );
}

/**
 * A product in the store, as the tag buyers see it (its card in its case, its price, what it is and what is
 * left), and under it what the store does with it: how many copies there are, which is changed and then saved
 * (not saved by leaving the field), and whether it is on sale. A product that was taken off sale stays listed.
 */
function ProductTag({
  row,
  notice,
  onPatch,
}: {
  row: HouseListingRow;
  notice: Notice | null;
  onPatch: (
    row: HouseListingRow,
    body: Partial<Pick<HouseListingRow, 'stock' | 'status'>> & { expectedStock?: number },
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [stock, setStock] = useState(String(row.stock));
  const [busy, setBusy] = useState(false);
  const next = Number(stock);
  const valid = stock.trim() !== '' && Number.isInteger(next) && next >= 0;
  const dirty = valid && next !== row.stock;

  async function run(body: Parameters<typeof onPatch>[1]) {
    setBusy(true);
    try {
      await onPatch(row, body);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (dirty && !busy) void run({ stock: next, expectedStock: row.stock });
  }

  return (
    <li className="tag-item">
      <DrawerTag
        item
        label={row.description}
        art={<CardPhotoThumb serialNumber={row.photoRef ?? ''} title={row.description} />}
        kicker={t('house.admin.product')}
        title={<bdi dir="auto">{row.description}</bdi>}
        amount={formatUsd(row.askingPrice)}
        lines={[
          { label: t('house.admin.col.code'), value: <Serial value={row.code} /> },
          {
            label: t('warehouse.intake.condition'),
            value: row.conditionGrade ? <bdi dir="auto">{row.conditionGrade}</bdi> : quiet,
          },
          { label: t('warehouse.intake.typeClass'), value: itemClassLabel(t, row.typeClass) },
        ]}
        status={
          row.status === 'removed' ? (
            <StatusBadge>{t('house.admin.removed')}</StatusBadge>
          ) : row.stock === 0 ? (
            <StatusBadge tone="warning">{t('house.admin.soldOut')}</StatusBadge>
          ) : (
            <StatusBadge tone="success">{t('house.admin.onSale')}</StatusBadge>
          )
        }
        note={t('house.inStock', { count: row.stock })}
      />

      <form className="tag-actions product-controls" onSubmit={save}>
        <Field label={t('house.admin.stock')} className="field--compact">
          <input
            type="number"
            min={0}
            value={stock}
            aria-label={t('house.admin.stockOf', { code: row.code })}
            aria-invalid={stock.trim() !== '' && !valid}
            dir="ltr"
            onChange={(e) => setStock(e.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" variant="secondary" disabled={!dirty || busy}>
          {t('admin.action.save')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void run({ status: row.status === 'active' ? 'removed' : 'active' })}
        >
          {row.status === 'active' ? t('house.admin.remove') : t('house.admin.restore')}
        </Button>
      </form>
      {stock.trim() !== '' && !valid && (
        <p className="field-error" role="alert">
          {t('admin.house.stockInvalid')}
        </p>
      )}
      {notice &&
        (notice.ok ? (
          <SuccessNote>{notice.text}</SuccessNote>
        ) : (
          <ErrorState message={notice.text} />
        ))}
    </li>
  );
}
