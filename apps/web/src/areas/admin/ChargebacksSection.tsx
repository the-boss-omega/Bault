import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { formatDateTime, formatUsd } from '../../shared/money';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { Button, EmptyState, ErrorState, Field, Panel, SkeletonTable } from '../../shared/ui/primitives';
import { IconReceipt } from '../../shared/ui/icons';

/** A settled card top-up that a provider could still reverse. */
interface ReversiblePayment {
  id: string;
  userId: string;
  username: string | null;
  provider: string;
  providerRef: string;
  amount: number;
  currency: string;
  createdAt: string;
}

/**
 * Chargebacks, recorded by an administrator.
 *
 * A provider reports a reversed card payment out of band — an email, a
 * dashboard — and the API has always had the route that books it: the top-up is
 * taken back off the wallet, with the handling fee unless Bault won the case.
 * Nothing in the product called it, so a reversal could not be recorded at all.
 */
export function ChargebacksSection({ onMsg }: { onMsg: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ReversiblePayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<ReversiblePayment | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ReversiblePayment[]>('/finance/chargebacks/reversible'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t('admin.chargebacks.title')} subtitle={t('admin.chargebacks.subtitle')} flush>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
      {rows === null ? (
        <SkeletonTable rows={4} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.chargebacks.empty')} icon={<IconReceipt />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.chargebacks.col.when')}</th>
                <th scope="col">{t('admin.chargebacks.col.customer')}</th>
                <th scope="col">{t('admin.chargebacks.col.reference')}</th>
                <th scope="col" className="td-end">
                  {t('admin.chargebacks.col.amount')}
                </th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('admin.chargebacks.col.when')}>
                    <span dir="ltr">{formatDateTime(r.createdAt, locale)}</span>
                  </td>
                  <td data-label={t('admin.chargebacks.col.customer')} dir="ltr">
                    {r.username ? `@${r.username}` : '—'}
                  </td>
                  <td data-label={t('admin.chargebacks.col.reference')}>
                    <code dir="ltr">{r.providerRef}</code>
                    <span className="dt-sub">{r.provider}</span>
                  </td>
                  <td data-label={t('admin.chargebacks.col.amount')} className="td-end num">
                    {formatUsd(r.amount)}
                  </td>
                  <td className="td-tight">
                    <Button size="sm" variant="danger" onClick={() => setRecording(r)}>
                      {t('admin.chargebacks.record')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recording && (
        <RecordDrawer
          payment={recording}
          onClose={() => setRecording(null)}
          onDone={() => {
            onMsg(t('admin.chargebacks.recorded', { amount: formatUsd(recording.amount) }));
            setRecording(null);
            void load();
          }}
        />
      )}
    </Panel>
  );
}

function RecordDrawer({
  payment,
  onClose,
  onDone,
}: {
  payment: ReversiblePayment;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [chargeFee, setChargeFee] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    try {
      await api.post(`/finance/chargebacks/${payment.id}`, {
        reason: reason.trim(),
        ...(caseRef.trim() ? { providerCaseRef: caseRef.trim() } : {}),
        chargeFee,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={t('admin.chargebacks.record')}
      subtitle={
        <span dir="ltr">
          {payment.username ? `@${payment.username} · ` : ''}
          {formatUsd(payment.amount)}
        </span>
      }
      onClose={onClose}
      dirty={reason.trim() !== ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => void record()}>
            {t('admin.chargebacks.confirm', { amount: formatUsd(payment.amount) })}
          </Button>
        </>
      }
    >
      <div className="stack stack--tight">
        {error && <ErrorState message={error} />}
        <p className="infobox">{t('admin.chargebacks.explain')}</p>
        <Field label={t('admin.chargebacks.reason')}>
          <textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('admin.chargebacks.caseRef')}>
          <input dir="ltr" maxLength={140} value={caseRef} onChange={(e) => setCaseRef(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={chargeFee} onChange={(e) => setChargeFee(e.target.checked)} />
          {t('admin.chargebacks.chargeFee')}
        </label>
      </div>
    </DetailDrawer>
  );
}
