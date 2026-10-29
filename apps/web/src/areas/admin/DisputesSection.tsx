import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { formatDate, formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import {
  Button,
  EmptyState,
  Panel,
  SkeletonTable,
  StatusBadge,
  type StatusTone,
} from '../../shared/ui/primitives';
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

  const load = useCallback(async () => {
    try {
      const [d, tx] = await Promise.all([
        api.get<Dispute[]>('/admin/disputes'),
        api.get<AdminTransaction[]>('/admin/transactions'),
      ]);
      setDisputes(d);
      setTransactions(tx);
    } catch (e) {
      onError((e as Error).message);
      setDisputes([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open() {
    try {
      await api.post('/admin/disputes', { transactionId, note: note || undefined });
      onMsg(t('admin.disputes.opened'));
      setTransactionId('');
      setNote('');
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const transaction = transactions.find((tx) => tx.id === transactionId) ?? null;
  const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions]);
  const newestFirst = useMemo(
    () => [...(disputes ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [disputes],
  );

  return (
    <>
      <Panel title={t('admin.disputes.openLegend')} subtitle={t('admin.disputes.subtitle')}>
        {transactions.length === 0 ? (
          <EmptyState title={t('admin.disputes.noTransactions')} icon={<IconGavel />} />
        ) : (
          <div className="request-form">
            <div className="stack stack--tight request-form-fields">
              <label className="field">
                <span className="field-label">{t('admin.disputes.col.transaction')}</span>
                <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)}>
                  <option value="">{t('admin.disputes.selectTransaction')}</option>
                  {transactions.map((tx) => (
                    <option key={tx.id} value={tx.id}>
                      {tx.id.slice(0, 8)} — {tx.type} — {formatUsd(tx.price)} —{' '}
                      {tx.createdAt.slice(0, 10)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('admin.disputes.notePlaceholder')}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
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
                        { label: t('wallet.col.type'), value: <Code value={transaction.type} /> },
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
                onClick={open}
              >
                {t('admin.disputes.openButton')}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t('admin.disputes.heading', { count: disputes?.length ?? 0 })}>
        {disputes === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : disputes.length === 0 ? (
          <EmptyState title={t('admin.disputes.empty')} icon={<IconGavel />} />
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

  async function save() {
    try {
      await api.patch(`/admin/disputes/${dispute.id}`, { status, ruling: ruling || undefined });
      await onSaved(t('admin.disputes.updated'));
    } catch (e) {
      onError((e as Error).message);
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
          { label: t('wallet.col.type'), value: <Code value={transaction.type} /> },
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
      <div className="case-controls">
        <input
          placeholder={t('admin.disputes.col.ruling')}
          aria-label={t('admin.disputes.col.ruling')}
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
        <Button size="sm" variant="secondary" onClick={save}>
          {t('admin.disputes.updateButton')}
        </Button>
      </div>
    </li>
  );
}
