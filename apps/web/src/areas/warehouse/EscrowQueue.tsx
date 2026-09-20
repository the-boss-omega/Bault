import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type TranslateFn } from '../../shared/i18n';
import { formatUsd } from '../../shared/money';
import { ESCROW_TONE, dealParties, escrowStatusLabel, type EscrowDeal } from '../../shared/escrow';
import { Button, EmptyState, ErrorState, Panel, SkeletonTable, StatusBadge, SuccessNote } from '../../shared/ui/primitives';
import { IconShield } from '../../shared/ui/icons';

/**
 * Escrow, from the bench.
 *
 * Every escrow deal passed through the warehouse and there was no screen for
 * it: nobody could book the seller's card in against its deal or record the
 * inspection, so no deal ever got past "funded". A counterparty with no Bault
 * account cannot click anything either, so their agreement, their payment and
 * their final confirmation are recorded here by an operator — visibly second-
 * hand, because the API writes the operator's id on each of those events.
 */
export function EscrowQueue() {
  const { t } = useI18n();
  const [deals, setDeals] = useState<EscrowDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDeals(await api.get<EscrowDeal[]>('/escrow/queue'));
    } catch (e) {
      setError((e as Error).message);
      setDeals([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        setError(null);
        setMessage(ok);
        await load();
      } catch (e) {
        setMessage(null);
        setError((e as Error).message);
      }
    },
    [load],
  );

  return (
    <Panel title={t('escq.title')} subtitle={t('escq.subtitle')} flush>
      {message && <SuccessNote>{message}</SuccessNote>}
      {error && <ErrorState message={error} />}
      {deals === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : deals.length === 0 ? (
        <EmptyState title={t('escq.empty')} icon={<IconShield />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('esc.col.deal')}</th>
                <th scope="col">{t('escq.col.parties')}</th>
                <th scope="col">{t('esc.col.status')}</th>
                <th scope="col">{t('escq.col.step')}</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const { buyer, seller } = dealParties(d);
                return (
                  <tr key={d.id}>
                    <td data-label={t('esc.col.deal')} className="dt-primary">
                      <code dir="ltr">{d.code}</code>
                      <span className="dt-sub">{d.description}</span>
                      <span className="dt-sub" dir="ltr">
                        {formatUsd(d.valueMinor)}
                      </span>
                    </td>
                    <td data-label={t('escq.col.parties')}>
                      <span className="dt-sub">{t('escq.seller', { who: seller ?? '—' })}</span>
                      <span className="dt-sub">{t('escq.buyer', { who: buyer ?? '—' })}</span>
                    </td>
                    <td data-label={t('esc.col.status')}>
                      <StatusBadge tone={ESCROW_TONE[d.status] ?? 'neutral'}>{escrowStatusLabel(t, d.status)}</StatusBadge>
                    </td>
                    <td data-label={t('escq.col.step')}>
                      <DealStep deal={d} t={t} onAct={act} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** The one thing the bench can do next on this deal, if anything. */
function DealStep({
  deal,
  t,
  onAct,
}: {
  deal: EscrowDeal;
  t: TranslateFn;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<'yes' | 'no'>('yes');
  const external = deal.counterpartyUserId === null;
  // The side the account-less counterparty is on, when there is one.
  const externalSide: 'buyer' | 'seller' = deal.raiserRole === 'buyer' ? 'seller' : 'buyer';
  const buyerExternal = external && externalSide === 'buyer';
  const post = (path: string, body: Record<string, unknown>, ok: string) =>
    void onAct(() => api.post(`/escrow/${deal.id}/${path}`, body), ok);

  if (deal.status === 'proposed') {
    return external ? (
      <div className="actions">
        <Button size="sm" variant="secondary" onClick={() => post('agree', { notes: text || undefined }, t('esc.agreed'))}>
          {t('escq.recordAgreement')}
        </Button>
      </div>
    ) : (
      <span className="hint">{t('escq.waitingParties')}</span>
    );
  }

  if (deal.status === 'agreed') {
    return buyerExternal ? (
      <div className="stack stack--tight">
        <label className="field">
          <span className="field-label">{t('escq.reference')}</span>
          <input value={text} maxLength={140} onChange={(e) => setText(e.target.value)} dir="ltr" />
        </label>
        <Button
          size="sm"
          variant="gold"
          disabled={!text.trim()}
          onClick={() => post('fund', { reference: text.trim() }, t('esc.funded'))}
        >
          {t('escq.recordFunds')}
        </Button>
      </div>
    ) : (
      <span className="hint">{t('escq.waitingFunds')}</span>
    );
  }

  if (deal.status === 'funded') {
    // The seller's card arrives and is booked in like any other; this ties the
    // booked card to the deal, by the label on it.
    return (
      <div className="stack stack--tight">
        <label className="field">
          <span className="field-label">{t('escq.scanCard')}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} dir="ltr" placeholder="SN-…" />
        </label>
        <Button
          size="sm"
          variant="gold"
          disabled={!text.trim()}
          onClick={() => post('receive-item', { itemId: text.trim() }, t('escq.received'))}
        >
          {t('escq.receive')}
        </Button>
      </div>
    );
  }

  if (deal.status === 'inspecting') {
    return (
      <div className="stack stack--tight">
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <label className="check">
            <input type="radio" checked={matches === 'yes'} onChange={() => setMatches('yes')} />
            {t('escq.matches')}
          </label>
          <label className="check">
            <input type="radio" checked={matches === 'no'} onChange={() => setMatches('no')} />
            {t('escq.doesNotMatch')}
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t('escq.findings')}</span>
          <textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
        </label>
        <Button
          size="sm"
          variant={matches === 'yes' ? 'gold' : 'danger'}
          disabled={!text.trim()}
          onClick={() => post('inspect', { matches: matches === 'yes', notes: text.trim() }, t('escq.inspected'))}
        >
          {t('escq.recordInspection')}
        </Button>
      </div>
    );
  }

  if (deal.status === 'awaiting_release') {
    const released = externalSide === 'buyer' ? deal.buyerReleasedAt : deal.sellerReleasedAt;
    return external && !released ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => post('release', { side: externalSide }, t('esc.released'))}
      >
        {t(externalSide === 'buyer' ? 'escq.recordBuyerRelease' : 'escq.recordSellerRelease')}
      </Button>
    ) : (
      <span className="hint">{t('escq.waitingRelease')}</span>
    );
  }

  return null;
}
