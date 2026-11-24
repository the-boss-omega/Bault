import { useCallback, useState } from 'react';
import { api } from '../../shared/api';
import { formatDateTime, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import { Button, EmptyState, Field, Panel, SkeletonTable, SuccessNote } from '../../shared/ui/primitives';
import { IconReceipt } from '../../shared/ui/icons';
import { LoadFailure } from './RollTools';

export interface ReversiblePayment {
  kind: 'external_payment' | 'wallet_request';
  id: string;
  code?: string | null;
  provider?: string | null;
  providerRef?: string | null;
  fundingSource?: string | null;
  amount: number;
  currency: string;
  completedAt?: string | null;
  createdAt: string;
}

interface Recorded {
  status: string;
  reversedMinor: number;
  feeMinor: number;
}

const pathFor = (p: ReversiblePayment) =>
  p.kind === 'wallet_request'
    ? `/finance/chargebacks/wallet-requests/${p.id}`
    : `/finance/chargebacks/${p.id}`;

export function ChargebacksPanel() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ReversiblePayment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReversiblePayment | null>(null);
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [chargeFee, setChargeFee] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const list = await api.get<ReversiblePayment[]>('/finance/chargebacks/reversible');
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const name = (p: ReversiblePayment) =>
    p.kind === 'wallet_request'
      ? t('admin.chargebacks.cashIn', { code: p.code ?? p.id.slice(0, 8) })
      : t('admin.chargebacks.payment', { provider: p.provider ?? '', ref: p.providerRef ?? p.id.slice(0, 8) });

  function start(p: ReversiblePayment) {
    setOpen(p);
    setReason('');
    setCaseRef('');
    setChargeFee(true);
    setError(null);
    setDone(null);
  }

  async function record() {
    if (!open || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Recorded>(pathFor(open), {
        reason: reason.trim(),
        providerCaseRef: caseRef.trim() || undefined,
        chargeFee,
      });
      setDone(
        r.feeMinor > 0
          ? t('admin.chargebacks.doneFee', {
              what: name(open),
              amount: formatUsd(r.reversedMinor),
              fee: formatUsd(r.feeMinor),
            })
          : t('admin.chargebacks.done', { what: name(open), amount: formatUsd(r.reversedMinor) }),
      );
      setOpen(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={t('admin.chargebacks.title')}
      subtitle={t('admin.chargebacks.subtitle')}
      tools={
        <Button size="sm" variant="primary" icon={<IconReceipt />} loading={loading} onClick={() => void load()}>
          {t('admin.chargebacks.show')}
        </Button>
      }
    >
      {done && <SuccessNote>{done}</SuccessNote>}
      {loadError ? (
        <LoadFailure message={loadError} onRetry={() => void load()} />
      ) : rows === null ? (
        loading ? (
          <SkeletonTable rows={3} columns={4} />
        ) : (
          <EmptyState title={t('admin.chargebacks.notLoaded')} icon={<IconReceipt />} />
        )
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.chargebacks.empty')} icon={<IconReceipt />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.chargebacks.col.payment')}</th>
                <th scope="col" className="td-end">
                  {t('admin.chargebacks.col.amount')}
                </th>
                <th scope="col">{t('admin.chargebacks.col.settled')}</th>
                <th scope="col">
                  <span className="sr-only">{t('admin.chargebacks.col.action')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.kind}:${p.id}`}>
                  <td data-label={t('admin.chargebacks.col.payment')}>
                    <bdi dir="ltr">{name(p)}</bdi>
                  </td>
                  <td data-label={t('admin.chargebacks.col.amount')} className="td-end num" dir="ltr">
                    {formatUsd(p.amount)}
                  </td>
                  <td data-label={t('admin.chargebacks.col.settled')}>
                    {formatDateTime(p.completedAt ?? p.createdAt, locale)}
                  </td>
                  <td data-label={t('admin.chargebacks.col.action')}>
                    <Button size="sm" variant="secondary" onClick={() => start(p)}>
                      {t('admin.chargebacks.record')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <form
          className="stack stack--tight stack-top"
          aria-label={t('admin.chargebacks.formTitle', { what: name(open) })}
          onSubmit={(e) => {
            e.preventDefault();
            void record();
          }}
        >
          <p className="field-hint">
            {t('admin.chargebacks.formIntro', { what: name(open), amount: formatUsd(open.amount) })}
          </p>
          <Field label={t('admin.chargebacks.reason')}>
            <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={t('admin.chargebacks.caseRef')} hint={t('admin.chargebacks.caseRefHint')}>
            <input value={caseRef} maxLength={140} onChange={(e) => setCaseRef(e.target.value)} dir="ltr" />
          </Field>
          <label className="check">
            <input type="checkbox" checked={chargeFee} onChange={(e) => setChargeFee(e.target.checked)} />
            <span>{t('admin.chargebacks.chargeFee')}</span>
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <Button type="submit" variant="danger" size="sm" loading={busy} disabled={!reason.trim()}>
              {t('admin.chargebacks.submit')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(null)}>
              {t('admin.chargebacks.cancel')}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
