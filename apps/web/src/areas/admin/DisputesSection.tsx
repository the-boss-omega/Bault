import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { formatDate, formatUsd } from '../../shared/money';
import { hasMessage, useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  type StatusTone,
} from '../../shared/ui/primitives';
import { LoadFailure, NoMatch, RollTools, matchesQuery } from './RollTools';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Code } from '../../shared/ui/Serial';
import { IconGavel } from '../../shared/ui/icons';

interface Dispute {
  id: string;
  transactionId: string;
  status: string;
  ruling: string | null;
  note: string | null;
  createdAt: string;
}

const DISPUTE_STATUSES = ['open', 'investigating', 'ruled', 'closed'];
const DISPUTE_LABEL: Record<string, MessageKey> = {
  open: 'admin.disputes.status.open',
  investigating: 'admin.disputes.status.investigating',
  ruled: 'admin.disputes.status.ruled',
  closed: 'admin.disputes.status.closed',
};
const DISPUTE_TONE: Record<string, StatusTone> = {
  open: 'warning',
  investigating: 'info',
  ruled: 'success',
  closed: 'neutral',
};

const txType = (t: TranslateFn, type: string) => {
  const key = `admin.disputes.txType.${type}`;
  return hasMessage(key) ? t(key) : type;
};

interface AdminTransaction {
  id: string;
  type: string;
  price: number;
  buyerId: string | null;
  sellerId: string | null;
  createdAt: string;
}

export function DisputesSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openNotice, setOpenNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [d, tx] = await Promise.all([
        api.get<Dispute[]>('/admin/disputes'),
        api.get<AdminTransaction[]>('/admin/transactions'),
      ]);
      setDisputes(d);
      setTransactions(tx);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open() {
    if (!transactionId || opening) return;
    setOpening(true);
    setOpenNotice(null);
    try {
      await api.post('/admin/disputes', { transactionId, note: note.trim() || undefined });
      const text = t('admin.disputes.opened');
      onMsg(text);
      setOpenNotice({ ok: true, text });
      setTransactionId('');
      setNote('');
      await load();
    } catch (e) {
      setOpenNotice({ ok: false, text: (e as Error).message });
      onError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  const transaction = transactions.find((tx) => tx.id === transactionId) ?? null;
  const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions]);
  const newestFirst = useMemo(
    () =>
      [...(disputes ?? [])]
        .filter(
          (d) =>
            (statusFilter === 'all' || d.status === statusFilter) &&
            matchesQuery(query, d.id, d.transactionId, d.ruling, d.note),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [disputes, query, statusFilter],
  );

  return (
    <>
      <Panel title={t('admin.disputes.openLegend')} subtitle={t('admin.disputes.subtitle')}>
        {loadError ? (
          <LoadFailure message={loadError} onRetry={() => void load()} />
        ) : disputes === null ? (
          <SkeletonTable rows={2} columns={2} />
        ) : transactions.length === 0 ? (
          <EmptyState title={t('admin.disputes.noTransactions')} icon={<IconGavel />} />
        ) : (
          <div className="request-form">
            <div className="stack stack--tight request-form-fields">
              <label className="field">
                <span className="field-label">{t('admin.disputes.col.transaction')}</span>
                <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)}>
                  <option value="">{t('admin.disputes.selectTransaction')}</option>
                  {[...transactions]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((tx) => (
                      <option key={tx.id} value={tx.id}>
                        {t('admin.disputes.transactionOption', {
                          code: tx.id.slice(0, 8),
                          type: txType(t, tx.type),
                          amount: formatUsd(tx.price),
                          date: formatDate(tx.createdAt, locale),
                        })}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('admin.disputes.notePlaceholder')}</span>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  dir="auto"
                />
              </label>
            </div>

            {/* The file as it will be opened: the transaction in question, its sum, and the note that goes with it. */}
            <aside className="request-slip">
              <DrawerTag
                kicker={t('admin.disputes.col.transaction')}
                title={
                  transaction ? (
                    <Code value={transaction.id.slice(0, 8)} />
                  ) : (
                    <span className="drawer-tag-quiet">
                      {t('admin.disputes.selectTransaction')}
                    </span>
                  )
                }
                amount={transaction ? formatUsd(transaction.price) : undefined}
                lines={
                  transaction
                    ? [
                        { label: t('wallet.col.type'), value: txType(t, transaction.type) },
                        {
                          label: t('admin.storage.col.date'),
                          value: formatDate(transaction.createdAt, locale),
                        },
                      ]
                    : undefined
                }
                status={
                  <StatusBadge tone={DISPUTE_TONE.open}>
                    {t('admin.disputes.status.open')}
                  </StatusBadge>
                }
              >
                {note.trim() && (
                  <div className="ticket-note">
                    <span className="slip-label">{t('admin.coverage.col.note')}</span>
                    <p>{note.trim()}</p>
                  </div>
                )}
              </DrawerTag>
            </aside>

            <div className="row request-form-actions">
              <Button
                variant="primary"
                icon={<IconGavel />}
                disabled={!transactionId}
                loading={opening}
                onClick={() => void open()}
              >
                {t('admin.disputes.openButton')}
              </Button>
              {!transactionId && !openNotice && (
                <span className="hint">{t('admin.disputes.pickFirst')}</span>
              )}
            </div>
            {openNotice &&
              (openNotice.ok ? (
                <SuccessNote>{openNotice.text}</SuccessNote>
              ) : (
                <ErrorState message={openNotice.text} />
              ))}
          </div>
        )}
      </Panel>

      <Panel title={t('admin.disputes.heading', { count: disputes?.length ?? 0 })}>
        {loadError ? null : disputes === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : disputes.length === 0 ? (
          <EmptyState
            title={t('admin.disputes.empty')}
            text={t('admin.disputes.emptyText')}
            icon={<IconGavel />}
          />
        ) : (
          <>
            <RollTools
              label={t('admin.disputes.tools')}
              query={query}
              onQuery={setQuery}
              placeholder={t('admin.disputes.search')}
              shown={newestFirst.length}
              total={disputes.length}
            >
              <Field label={t('admin.disputes.filterStatus')} className="field--compact">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">{t('admin.requests.filterAll')}</option>
                  {DISPUTE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(DISPUTE_LABEL[s]!)}
                    </option>
                  ))}
                </select>
              </Field>
            </RollTools>
            {newestFirst.length === 0 ? (
              <NoMatch
                query={query}
                onClear={() => {
                  setQuery('');
                  setStatusFilter('all');
                }}
              />
            ) : (
              <ul className="tag-grid">
                {newestFirst.map((d) => (
                  <DisputeCase
                    key={d.id}
                    dispute={d}
                    transaction={byId.get(d.transactionId) ?? null}
                    onSaved={async (m) => {
                      onMsg(m);
                      await load();
                    }}
                    onError={onError}
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
 * A dispute as a case file: its number, what has been ruled (or that nothing has), the transaction it is
 * about, and where it stands, on paper. Moving it on is done under the file, in the page's own controls.
 */
function DisputeCase({
  dispute,
  transaction,
  onSaved,
  onError,
}: {
  dispute: Dispute;
  transaction: AdminTransaction | null;
  onSaved: (m: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState(dispute.status);
  const [ruling, setRuling] = useState(dispute.ruling ?? '');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const changed = status !== dispute.status || ruling.trim() !== (dispute.ruling ?? '').trim();
  const missingRuling = status === 'ruled' && ruling.trim() === '';
  const showMissing = tried && missingRuling;
  const rulingError = `ruling-${dispute.id}-error`;

  async function save() {
    setTried(true);
    if (!changed || busy || missingRuling) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.patch(`/admin/disputes/${dispute.id}`, {
        status,
        ruling: ruling.trim() || undefined,
      });
      const key = DISPUTE_LABEL[status];
      await onSaved(t('admin.disputes.updated', { status: key ? t(key) : status }));
    } catch (e) {
      setFailure((e as Error).message);
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label = DISPUTE_LABEL[dispute.status];
  const lines = [
    { label: t('admin.disputes.col.id'), value: <Code value={dispute.id.slice(0, 8)} /> },
    {
      label: t('admin.disputes.col.transaction'),
      value: <Code value={dispute.transactionId.slice(0, 8)} />,
    },
    ...(transaction
      ? [
          { label: t('wallet.col.type'), value: txType(t, transaction.type) },
          {
            label: t('market.mine.col.price'),
            value: <span dir="ltr">{formatUsd(transaction.price)}</span>,
          },
        ]
      : []),
    { label: t('inbound.parcel.openedAt'), value: formatDate(dispute.createdAt, locale) },
  ];

  return (
    <li className="tag-item">
      {/* The headline is the ruling, and says that it is: a case with none has a dash, not the word standing as if it were one. */}
      <DrawerTag
        item
        kicker={t('admin.disputes.col.ruling')}
        title={
          dispute.ruling?.trim() ? dispute.ruling : <span className="drawer-tag-quiet">—</span>
        }
        lines={lines}
        status={
          <StatusBadge tone={DISPUTE_TONE[dispute.status] ?? 'neutral'}>
            {label ? t(label) : dispute.status}
          </StatusBadge>
        }
      >
        {dispute.note?.trim() && <blockquote className="case-note">{dispute.note}</blockquote>}
      </DrawerTag>
      <form
        className="case-controls"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          placeholder={t('admin.disputes.col.ruling')}
          aria-label={t('admin.disputes.col.ruling')}
          aria-invalid={showMissing}
          aria-describedby={showMissing ? rulingError : undefined}
          value={ruling}
          onChange={(e) => setRuling(e.target.value)}
          dir="auto"
        />
        <select
          value={status}
          aria-label={t('admin.col.status')}
          onChange={(e) => setStatus(e.target.value)}
        >
          {DISPUTE_STATUSES.map((s) => {
            const key = DISPUTE_LABEL[s];
            return (
              <option key={s} value={s}>
                {key ? t(key) : s}
              </option>
            );
          })}
        </select>
        <Button type="submit" size="sm" variant="secondary" disabled={!changed} loading={busy}>
          {t('admin.disputes.updateButton')}
        </Button>
      </form>
      {showMissing && (
        <p className="field-error" id={rulingError} role="alert">
          {t('admin.disputes.rulingRequired')}
        </p>
      )}
      {failure && <ErrorState message={failure} />}
    </li>
  );
}
