import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import {
  ITEM_CLASSES,
  disposalCategoryLabel,
  disposalOutcomeLabel,
  type ArrivalDisposal,
} from '../../shared/itemClasses';
import { formatDateTime } from '../../shared/money';
import {
  Button,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
} from '../../shared/ui/primitives';
import { IconArchive, IconScan, IconSearch } from '../../shared/ui/icons';
import { NoteLine, useNote } from './feedback';

/** `GET /custody/items/:label` — one item, by whatever was scanned. */
interface LookedUp {
  id: string;
  serialNumber: string;
  barcode: string;
  description: string;
  typeClass: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag: boolean;
  binSerial: string | null;
  binZone: string | null;
  ownerUsername: string | null;
}

interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
}

const STATE_LABEL: Record<string, MessageKey> = {
  received: 'vault.state.received',
  stored: 'vault.state.stored',
  listed: 'vault.state.listed',
  'on-hold': 'vault.state.onHold',
  sold: 'vault.state.sold',
  shipped: 'vault.state.shipped',
  donated: 'vault.state.donated',
  consigned: 'vault.state.consigned',
  at_grader: 'vault.state.atGrader',
  discarded: 'vault.state.discarded',
};

export function lifecycleLabel(t: TranslateFn, state: string): string {
  const key = STATE_LABEL[state];
  return key ? t(key) : state;
}

/**
 * Look a card up by scanning it: what it is, whose, where, and everything that
 * has happened to it — and correct what intake got wrong.
 *
 * There was no way to answer "what is this card?" at the bench short of the
 * admin console, and the only way to fix a typo made at intake was the admin's
 * raw item editor, which writes owner and state with no lifecycle check. A
 * correction here changes only description, class and condition, each one
 * recorded in the item's change history.
 */
export function ItemLookupPanel({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [scan, setScan] = useState('');
  const [found, setFound] = useState<LookedUp | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [description, setDescription] = useState('');
  const [typeClass, setTypeClass] = useState('');
  const [conditionGrade, setConditionGrade] = useState('');
  const [busy, setBusy] = useState(false);
  const { note, ok, fail, clear } = useNote();

  const open = useCallback(
    async (label: string) => {
      clear();
      try {
        const [item, events] = await Promise.all([
          api.get<LookedUp>(`/custody/items/${encodeURIComponent(label)}`),
          api.get<TimelineEvent[]>(`/custody/items/${encodeURIComponent(label)}/timeline`),
        ]);
        setFound(item);
        setTimeline(events);
        setDescription(item.description);
        setTypeClass(item.typeClass);
        setConditionGrade(item.conditionGrade ?? '');
      } catch (e) {
        setFound(null);
        setTimeline(null);
        fail((e as Error).message);
      }
    },
    [clear, fail],
  );

  const patches = found
    ? [
        description.trim() !== found.description ? { field: 'description', value: description.trim() } : null,
        typeClass !== found.typeClass ? { field: 'typeClass', value: typeClass } : null,
        conditionGrade.trim() !== (found.conditionGrade ?? '')
          ? { field: 'conditionGrade', value: conditionGrade.trim() }
          : null,
      ].filter((p): p is { field: string; value: string } => p !== null)
    : [];

  async function correct() {
    if (!found || patches.length === 0) return;
    setBusy(true);
    try {
      await api.patch(`/intake/items/${found.id}`, { patches });
      const line = t('warehouse.lookup.corrected', { serial: found.serialNumber, count: patches.length });
      ok(line);
      onLog(line);
      await open(found.id);
      ok(line);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('warehouse.lookup.title')} subtitle={t('warehouse.lookup.subtitle')}>
      <form
        className="form-grid row-baseline"
        onSubmit={(e) => {
          e.preventDefault();
          if (scan.trim()) void open(scan.trim());
        }}
      >
        <Field label={t('warehouse.relocate.scanItem')} hint={t('warehouse.relocate.scanItemHint')}>
          <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="SN-…" dir="ltr" />
        </Field>
        <div className="field">
          <span className="field-label" aria-hidden="true">
            &nbsp;
          </span>
          <Button type="submit" variant="navy" icon={<IconSearch />} disabled={!scan.trim()}>
            {t('warehouse.lookup.find')}
          </Button>
        </div>
      </form>

      <NoteLine note={note} />

      {found && (
        <div className="stack stack--tight stack-top">
          <dl className="detail-list">
            <DetailRow label={t('warehouse.lookup.serial')}>
              <code dir="ltr">{found.serialNumber}</code>
            </DetailRow>
            <DetailRow label={t('warehouse.lookup.owner')}>
              <span dir="ltr">{found.ownerUsername ? `@${found.ownerUsername}` : '—'}</span>
            </DetailRow>
            <DetailRow label={t('warehouse.lookup.state')}>
              <StatusBadge>{lifecycleLabel(t, found.lifecycleState)}</StatusBadge>
              {found.holdFlag && (
                <>
                  {' '}
                  <StatusBadge tone="error">{t('vault.state.onHold')}</StatusBadge>
                </>
              )}
            </DetailRow>
            <DetailRow label={t('warehouse.lookup.shelf')}>
              <span dir="ltr">
                {found.binSerial ? `${found.binSerial} (${found.binZone ?? '—'})` : t('warehouse.status.unshelved')}
              </span>
            </DetailRow>
          </dl>

          <h3 className="drawer-heading">{t('warehouse.lookup.correctHeading')}</h3>
          <div className="form-grid">
            <Field label={t('warehouse.intake.description')}>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label={t('warehouse.intake.typeClass')}>
              <select value={typeClass} onChange={(e) => setTypeClass(e.target.value)}>
                {!ITEM_CLASSES.some((c) => c.key === typeClass) && <option value={typeClass}>{typeClass}</option>}
                {ITEM_CLASSES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('warehouse.intake.condition')}>
              <input value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} />
            </Field>
          </div>
          <div className="row row--end">
            <Button variant="gold" loading={busy} disabled={patches.length === 0} onClick={() => void correct()}>
              {t('warehouse.lookup.save')}
            </Button>
          </div>

          <h3 className="drawer-heading">{t('warehouse.lookup.history')}</h3>
          {timeline === null || timeline.length === 0 ? (
            <p className="hint">{t('warehouse.lookup.noHistory')}</p>
          ) : (
            <ul className="timeline">
              {timeline.map((ev, i) => (
                <li key={`${ev.at}-${i}`}>
                  <p className="dt-primary">{ev.summary || ev.kind}</p>
                  <p className="dt-sub" dir="ltr">
                    {formatDateTime(ev.at, locale)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Send a card to another warehouse.
 *
 * Recorded as a completed transfer with the destination and a relocate event,
 * so the card's history shows where it went. The scan is resolved to the item
 * first because the transfer route takes the internal id.
 */
export function TransferPanel({ onLog, onDone }: { onLog: (line: string) => void; onDone: () => void }) {
  const { t } = useI18n();
  const [scan, setScan] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [shelf, setShelf] = useState('');
  const [verified, setVerified] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const { note, ok, fail } = useNote();

  const complete = scan.trim() && warehouse.trim() && shelf.trim() && verified && notes.trim();

  async function send() {
    setBusy(true);
    try {
      const item = await api.get<LookedUp>(`/custody/items/${encodeURIComponent(scan.trim())}`);
      await api.post('/services/warehouse-transfer', {
        itemId: item.id,
        destinationWarehouse: warehouse.trim(),
        destinationBin: shelf.trim(),
        itemVerified: verified,
        notes: notes.trim(),
      });
      const line = t('warehouse.transfer.done', { serial: item.serialNumber, warehouse: warehouse.trim() });
      ok(line);
      onLog(line);
      setScan('');
      setShelf('');
      setNotes('');
      setVerified(false);
      onDone();
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('warehouse.transfer.title')} subtitle={t('warehouse.transfer.subtitle')}>
      <div className="form-grid">
        <Field label={t('warehouse.relocate.scanItem')}>
          <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="SN-…" dir="ltr" />
        </Field>
        <Field label={t('warehouse.transfer.warehouse')}>
          <input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
        </Field>
        <Field label={t('warehouse.transfer.shelf')}>
          <input value={shelf} onChange={(e) => setShelf(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('warehouse.notes')}>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          {t('queue.fulfill.itemVerified')}
        </label>
        <span className="spacer" />
        <Button variant="secondary" icon={<IconScan />} loading={busy} disabled={!complete} onClick={() => void send()}>
          {t('warehouse.transfer.submit')}
        </Button>
      </div>
      <NoteLine note={note} />
    </Panel>
  );
}

interface ReconcileResult {
  totalItems: number;
  onShelf: number;
  checkedAt: string;
  issues: {
    id: string;
    serialNumber: string;
    description: string;
    state: string;
    bin?: string;
    problem: 'no_shelf' | 'retired_shelf' | 'hold_mismatch';
  }[];
}

const PROBLEM_LABEL: Record<ReconcileResult['issues'][number]['problem'], MessageKey> = {
  no_shelf: 'warehouse.reconcile.noShelf',
  retired_shelf: 'warehouse.reconcile.retiredShelf',
  hold_mismatch: 'warehouse.reconcile.holdMismatch',
};

/**
 * A stock check on the records: how much is on the shelves, and which records
 * contradict themselves. It cannot count the building; it says what to go and
 * look at.
 */
export function ReconcilePanel() {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    try {
      setResult(await api.post<ReconcileResult>('/custody/reconcile'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={t('warehouse.reconcile.title')}
      subtitle={t('warehouse.reconcile.subtitle')}
      tools={
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
          {t('warehouse.reconcile.run')}
        </Button>
      }
    >
      {error && <ErrorState message={error} />}
      {result && (
        <div className="stack stack--tight">
          <p className="hint">
            {t('warehouse.reconcile.summary', {
              onShelf: result.onShelf.toLocaleString(),
              total: result.totalItems.toLocaleString(),
              when: formatDateTime(result.checkedAt, locale),
            })}
          </p>
          {result.issues.length === 0 ? (
            <StatusBadge tone="success">{t('warehouse.reconcile.clean')}</StatusBadge>
          ) : (
            <div className="dt-wrap dt-wrap--stack">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('warehouse.lookup.serial')}</th>
                    <th scope="col">{t('warehouse.intake.description')}</th>
                    <th scope="col">{t('warehouse.reconcile.problem')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((issue) => (
                    <tr key={`${issue.problem}-${issue.id}`}>
                      <td data-label={t('warehouse.lookup.serial')}>
                        <code dir="ltr">{issue.serialNumber}</code>
                      </td>
                      <td data-label={t('warehouse.intake.description')}>{issue.description}</td>
                      <td data-label={t('warehouse.reconcile.problem')}>
                        <StatusBadge tone="warning">{t(PROBLEM_LABEL[issue.problem])}</StatusBadge>
                        {issue.bin && (
                          <span className="dt-sub" dir="ltr">
                            {issue.bin}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Every arrival that did not go into a vault, newest first. Recording one was
 * possible and reading them back was not, so nobody at the bench could check
 * what had already been filed.
 */
export function DisposalsList({ version }: { version: number }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ArrivalDisposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ArrivalDisposal[]>('/intake/disposals'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  return (
    <Panel title={t('warehouse.disposals.title')} flush>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
      {rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('warehouse.disposals.empty')} icon={<IconArchive />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('warehouse.disposals.col.code')}</th>
                <th scope="col">{t('warehouse.intake.ownerUsername')}</th>
                <th scope="col">{t('warehouse.disposal.category')}</th>
                <th scope="col">{t('warehouse.disposal.outcome')}</th>
                <th scope="col">{t('warehouse.disposals.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('warehouse.disposals.col.code')}>
                    <code dir="ltr">{r.code}</code>
                    <span className="dt-sub">{r.description}</span>
                  </td>
                  <td data-label={t('warehouse.intake.ownerUsername')} dir="ltr">
                    {r.ownerUsername ? `@${r.ownerUsername}` : '—'}
                  </td>
                  <td data-label={t('warehouse.disposal.category')}>{disposalCategoryLabel(t, r.category)}</td>
                  <td data-label={t('warehouse.disposal.outcome')}>
                    {disposalOutcomeLabel(t, r.outcome)}
                    <span className="dt-sub">{r.notes}</span>
                  </td>
                  <td data-label={t('warehouse.disposals.col.when')} dir="ltr">
                    {formatDateTime(r.occurredAt, locale)}
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
