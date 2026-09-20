import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
import {
  ESCROW_TONE,
  escrowEventLabel,
  escrowStatusLabel,
  nextStep,
  type EscrowDeal,
  type EscrowEvent,
} from '../../../shared/escrow';
import { Button, EmptyState, ErrorState, Field, MoneyField, Panel, StatusBadge, SuccessNote } from '../../../shared/ui/primitives';
import { DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { IconAlert, IconShield, IconUsers } from '../../../shared/ui/icons';

interface Terms {
  feeBps: number;
  minimumFeeMinor: number;
  minimumValueMinor: number;
}

interface Detail {
  deal: EscrowDeal;
  events: EscrowEvent[];
  buyerId: string | null;
  sellerId: string | null;
}

/**
 * A private deal with Bault standing in the middle.
 *
 * The screen is built around the two GATES, because they are the product. A
 * seller is looking for one sentence — "the money is held, it is safe to send
 * the card" — and a buyer is looking for another — "we have looked at it and
 * here is what we found". Everything else is around those.
 *
 * The inspection finding is rendered before the release controls and rendered
 * loudly when it is negative, because a buyer clicking release without having
 * read "this is a PSA 8, not a PSA 10" is the one failure this whole feature
 * exists to prevent.
 */
export function EscrowTab({ meId }: { meId: string | null }) {
  const { t, locale } = useI18n();
  const [deals, setDeals] = useState<EscrowDeal[] | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [held, setHeld] = useState<{ heldMinor: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The raise form.
  const [role, setRole] = useState<'buyer' | 'seller'>('seller');
  const [username, setUsername] = useState('');
  const [outsideName, setOutsideName] = useState('');
  const [outsideEmail, setOutsideEmail] = useState('');
  const [external, setExternal] = useState(false);
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [settlement, setSettlement] = useState<'buyer_vault' | 'ship_to_buyer'>('buyer_vault');

  const load = useCallback(async () => {
    try {
      const [mine, t2, h] = await Promise.all([
        api.get<EscrowDeal[]>('/escrow/mine'),
        api.get<Terms>('/escrow/terms'),
        api.get<{ heldMinor: number }>('/escrow/held'),
      ]);
      setDeals(mine);
      setTerms(t2);
      setHeld(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setDeals([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cents = dollarsToCents(value);
  const feePreview =
    terms && cents !== null && cents > 0
      ? Math.max(Math.ceil((cents * terms.feeBps) / 10_000), terms.minimumFeeMinor)
      : null;
  const belowFloor = terms !== null && cents !== null && cents > 0 && cents < terms.minimumValueMinor;

  const ready =
    description.trim() !== '' &&
    cents !== null &&
    cents > 0 &&
    !belowFloor &&
    (external ? outsideName.trim() !== '' && outsideEmail.trim() !== '' : username.trim() !== '');

  async function raise() {
    setBusy(true);
    try {
      const deal = await api.post<EscrowDeal>('/escrow', {
        raiserRole: role,
        counterpartyUsername: external ? undefined : username.trim(),
        counterpartyName: external ? outsideName.trim() : undefined,
        counterpartyEmail: external ? outsideEmail.trim() : undefined,
        description: description.trim(),
        valueMinor: cents,
        settlement,
      });
      setStatus(t('esc.raised', { code: deal.code }));
      setError(null);
      setDescription('');
      setValue('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} />}

      <Panel title={t('esc.title')} subtitle={t('esc.subtitle')}>
        <p className="field-hint">{t('esc.how')}</p>
        {terms && (
          <p className="field-hint">
            {t('esc.terms', {
              percent: (terms.feeBps / 100).toFixed(2),
              min: formatUsd(terms.minimumFeeMinor),
              floor: formatUsd(terms.minimumValueMinor),
            })}
          </p>
        )}
        {held !== null && held.heldMinor > 0 && (
          <p className="drawer-note drawer-note--hold">
            <IconShield />
            <span>{t('esc.heldNow', { amount: formatUsd(held.heldMinor) })}</span>
          </p>
        )}
      </Panel>

      <Panel title={t('esc.raise')} subtitle={t('esc.raiseSubtitle')}>
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
          <label className="field">
            <span className="field-label">{t('esc.yourSide')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'buyer' | 'seller')}>
              <option value="seller">{t('esc.side.seller')}</option>
              <option value="buyer">{t('esc.side.buyer')}</option>
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
            {t('esc.otherIsExternal')}
          </label>

          {external ? (
            <>
              <label className="field">
                <span className="field-label">{t('esc.theirName')}</span>
                <input value={outsideName} onChange={(e) => setOutsideName(e.target.value)} />
              </label>
              <Field label={t('esc.theirEmail')} hint={t('esc.externalHint')}>
                <input value={outsideEmail} dir="ltr" onChange={(e) => setOutsideEmail(e.target.value)} />
              </Field>
            </>
          ) : (
            <label className="field">
              <span className="field-label">{t('esc.theirUsername')}</span>
              <input value={username} dir="ltr" onChange={(e) => setUsername(e.target.value)} />
            </label>
          )}

          <Field label={t('esc.what')} hint={t('esc.whatHint')}>
            <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <MoneyField
            label={t('esc.value')}
            value={value}
            onChange={setValue}
            hint={
              belowFloor && terms
                ? t('esc.belowFloor', { floor: formatUsd(terms.minimumValueMinor) })
                : feePreview !== null
                  ? t('esc.feePreview', { amount: formatUsd(feePreview) })
                  : undefined
            }
          />

          <Field label={t('esc.settlement')} hint={t('esc.settlementHint')}>
            <select
              value={settlement}
              onChange={(e) => setSettlement(e.target.value as 'buyer_vault' | 'ship_to_buyer')}
            >
              <option value="buyer_vault">{t('esc.settlement.vault')}</option>
              <option value="ship_to_buyer">{t('esc.settlement.ship')}</option>
            </select>
          </Field>

          <div className="row">
            <Button variant="gold" icon={<IconUsers />} disabled={busy || !ready} onClick={() => void raise()}>
              {t('esc.raiseAction')}
            </Button>
            <span className="field-hint">{t('esc.feeOnYou')}</span>
          </div>
        </div>
      </Panel>

      <Panel title={t('esc.mine')} subtitle={t('esc.mineSubtitle')} flush>
        {deals === null ? (
          <p className="hint" style={{ padding: 'var(--sp-4) var(--sp-6)' }}>
            {t('grp.loading')}
          </p>
        ) : deals.length === 0 ? (
          <EmptyState title={t('esc.none')} text={t('esc.noneText')} icon={<IconShield />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('esc.col.deal')}</th>
                  <th scope="col">{t('esc.col.what')}</th>
                  <th scope="col">{t('esc.col.value')}</th>
                  <th scope="col">{t('esc.col.status')}</th>
                  <th scope="col">{t('esc.col.next')}</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const viewerIsBuyer =
                    (d.raiserRole === 'buyer' && d.raisedBy === meId) ||
                    (d.raiserRole === 'seller' && d.counterpartyUserId === meId);
                  return (
                    <tr key={d.id} className="is-clickable" tabIndex={0} onClick={() => setOpenId(d.id)}>
                      <td data-label={t('esc.col.deal')} className="dt-primary">
                        <code dir="ltr">{d.code}</code>
                      </td>
                      <td data-label={t('esc.col.what')}>{d.description}</td>
                      <td data-label={t('esc.col.value')} dir="ltr">
                        {formatUsd(d.valueMinor)}
                      </td>
                      <td data-label={t('esc.col.status')}>
                        <StatusBadge tone={ESCROW_TONE[d.status] ?? 'neutral'}>
                          {escrowStatusLabel(t, d.status)}
                        </StatusBadge>
                      </td>
                      <td data-label={t('esc.col.next')} className="hint">
                        {nextStep(t, d, viewerIsBuyer)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {openId && (
        <DealDrawer
          dealId={openId}
          meId={meId}
          locale={locale}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onStatus={setStatus}
          onError={setError}
        />
      )}
    </>
  );
}

function DealDrawer({
  dealId,
  meId,
  locale,
  onClose,
  onChanged,
  onStatus,
  onError,
}: {
  dealId: string;
  meId: string | null;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
  onStatus: (m: string | null) => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<Detail>(`/escrow/${dealId}`));
    } catch (e) {
      onError((e as Error).message);
    }
  }, [dealId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      onStatus(ok);
      onError(null);
      await load();
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return null;
  const { deal, events, buyerId, sellerId } = detail;
  const iAmBuyer = meId !== null && buyerId === meId;
  const iAmSeller = meId !== null && sellerId === meId;
  const mismatch = deal.inspectionMatches === 'no';
  const myRelease = iAmBuyer ? deal.buyerReleasedAt : deal.sellerReleasedAt;

  return (
    <DetailDrawer
      title={deal.code}
      subtitle={escrowStatusLabel(t, deal.status)}
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      <dl className="detail-list">
        <div className="detail-row">
          <dt className="detail-label">{t('esc.col.what')}</dt>
          <dd className="detail-value">{deal.description}</dd>
        </div>
        <div className="detail-row">
          <dt className="detail-label">{t('esc.col.value')}</dt>
          <dd className="detail-value" dir="ltr">
            {formatUsd(deal.valueMinor)}
            <span className="detail-value-sub">{t('esc.feeLine', { amount: formatUsd(deal.feeMinor) })}</span>
          </dd>
        </div>
        <div className="detail-row">
          <dt className="detail-label">{t('esc.otherSide')}</dt>
          <dd className="detail-value">
            {(() => {
              // Whoever the reader is NOT. A deal with an account named it only
              // as "A Bault account", which told nobody anything.
              const iRaised = deal.raisedBy === meId;
              if (!iRaised) return deal.raiserUsername ? `@${deal.raiserUsername}` : t('esc.otherAccount');
              if (deal.counterpartyUserId) {
                return deal.counterpartyUsername ? `@${deal.counterpartyUsername}` : t('esc.otherAccount');
              }
              return `${deal.counterpartyName ?? '—'} (${deal.counterpartyEmail ?? ''})`;
            })()}
          </dd>
        </div>
        {deal.fundedAt && (
          <div className="detail-row">
            <dt className="detail-label">{t('esc.funds')}</dt>
            <dd className="detail-value">
              <StatusBadge tone="success">{t('esc.fundsHeld')}</StatusBadge>
              <span className="detail-value-sub">
                {deal.fundingSource === 'external'
                  ? t('esc.fundedExternal', { reference: deal.fundingReference ?? '—' })
                  : t('esc.fundedWallet')}
              </span>
            </dd>
          </div>
        )}
      </dl>

      {/* The gate. Rendered before any release control, and loudly when the
          answer is no — a buyer clicking release without having read this is
          the one failure the whole feature exists to prevent. */}
      {deal.inspectedAt && (
        <p className={`drawer-note ${mismatch ? 'drawer-note--hold' : 'drawer-note--archive'}`}>
          <IconAlert />
          <span>
            <strong>{mismatch ? t('esc.inspectFailed') : t('esc.inspectPassed')}</strong>
            <br />
            {deal.inspectionNotes}
          </span>
        </p>
      )}

      {deal.status === 'proposed' && deal.counterpartyUserId === meId && (
        <div className="row stack-top">
          <Button
            variant="gold"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => api.post(`/escrow/${dealId}/agree`, {}), t('esc.agreed'))}
          >
            {t('esc.agree')}
          </Button>
        </div>
      )}

      {deal.status === 'agreed' && iAmBuyer && (
        <div className="row stack-top">
          <Button
            variant="gold"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => api.post(`/escrow/${dealId}/fund`, {}), t('esc.funded'))}
          >
            {t('esc.fund', { amount: formatUsd(deal.valueMinor) })}
          </Button>
          <span className="field-hint">{t('esc.fundHint')}</span>
        </div>
      )}

      {deal.status === 'awaiting_release' && (iAmBuyer || iAmSeller) && (
        <div className="stack stack--tight stack-top">
          {myRelease ? (
            <p className="field-hint">{t('esc.youConfirmed')}</p>
          ) : (
            <div className="row">
              <Button
                variant="gold"
                size="sm"
                disabled={busy}
                onClick={() => void act(() => api.post(`/escrow/${dealId}/release`, {}), t('esc.released'))}
              >
                {t('esc.release')}
              </Button>
              <span className="field-hint">{t('esc.releaseHint')}</span>
            </div>
          )}
        </div>
      )}

      {/* Calling it off before any money moved. The API always allowed it;
          nothing on screen did. */}
      {['proposed', 'agreed'].includes(deal.status) && (iAmBuyer || iAmSeller) && (
        <div className="stack stack--tight stack-top">
          <label className="field">
            <span className="field-label">{t('esc.cancelReason')}</span>
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim() === ''}
              onClick={() => void act(() => api.post(`/escrow/${dealId}/cancel`, { reason }), t('esc.cancelled'))}
            >
              {t('esc.cancelAction')}
            </Button>
          </div>
        </div>
      )}

      {['funded', 'inspecting', 'awaiting_release'].includes(deal.status) && (iAmBuyer || iAmSeller) && (
        <div className="stack stack--tight stack-top">
          <label className="field">
            <span className="field-label">{t('esc.returnReason')}</span>
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="row">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim() === ''}
              onClick={() =>
                void act(() => api.post(`/escrow/${dealId}/return`, { reason }), t('esc.returned'))
              }
            >
              {t('esc.returnAction')}
            </Button>
            <span className="field-hint">{t('esc.returnHint')}</span>
          </div>
        </div>
      )}

      <h3 className="drawer-heading">{t('esc.trail')}</h3>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id} className="detail-row" style={{ display: 'block' }}>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <StatusBadge tone="info" plain>
                {escrowEventLabel(t, e.eventType)}
              </StatusBadge>
              <span className="hint" dir="ltr">
                {formatDate(e.occurredAt, locale)}
              </span>
              {e.onBehalfOf && <StatusBadge tone="neutral" plain>{t('esc.onBehalf')}</StatusBadge>}
            </div>
            {e.notes && <p className="card-desc">{e.notes}</p>}
          </li>
        ))}
      </ul>
    </DetailDrawer>
  );
}
