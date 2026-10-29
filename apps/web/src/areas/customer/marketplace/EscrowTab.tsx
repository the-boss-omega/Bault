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
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Amount } from '../../../shared/ui/Serial';
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

export function EscrowTab({ meId }: { meId: string | null }) {
  const { t, locale } = useI18n();
  const [deals, setDeals] = useState<EscrowDeal[] | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [held, setHeld] = useState<{ heldMinor: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  // What has not been typed yet is a dash, never a value made up.
  const quiet = <span className="drawer-tag-quiet">—</span>;
  const otherSide = external ? (
    outsideName.trim() || outsideEmail.trim() ? (
      <>
        {outsideName.trim() && <bdi dir="auto">{outsideName.trim()}</bdi>}{' '}
        {outsideEmail.trim() && <bdi dir="ltr">({outsideEmail.trim()})</bdi>}
      </>
    ) : (
      quiet
    )
  ) : username.trim() ? (
    <bdi dir="ltr">@{username.trim().replace(/^@/, '')}</bdi>
  ) : (
    quiet
  );

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
        <div className="request-form">
          <div className="stack stack--tight request-form-fields">
            <label className="field">
              <span className="field-label">{t('esc.yourSide')}</span>
              <select value={role} onChange={(e) => setRole(e.target.value as 'buyer' | 'seller')}>
                <option value="seller">{t('esc.side.seller')}</option>
                <option value="buyer">{t('esc.side.buyer')}</option>
              </select>
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={external}
                onChange={(e) => setExternal(e.target.checked)}
              />
              {t('esc.otherIsExternal')}
            </label>

            {external ? (
              <>
                <label className="field">
                  <span className="field-label">{t('esc.theirName')}</span>
                  <input
                    value={outsideName}
                    dir="auto"
                    onChange={(e) => setOutsideName(e.target.value)}
                  />
                </label>
                <Field label={t('esc.theirEmail')} hint={t('esc.externalHint')}>
                  <input
                    value={outsideEmail}
                    dir="ltr"
                    onChange={(e) => setOutsideEmail(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <label className="field">
                <span className="field-label">{t('esc.theirUsername')}</span>
                <input value={username} dir="ltr" onChange={(e) => setUsername(e.target.value)} />
              </label>
            )}

            <Field label={t('esc.what')} hint={t('esc.whatHint')}>
              <input
                value={description}
                maxLength={500}
                dir="auto"
                onChange={(e) => setDescription(e.target.value)}
              />
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
          </div>

          {/* The deal as the other side will read it: the price, who is who, what it is for, what it costs and how it ends. */}
          <aside className="request-slip">
            <DrawerTag
              kicker={t('esc.value')}
              amount={cents !== null && cents > 0 ? formatUsd(cents) : '—'}
              lines={[
                {
                  label: t('esc.yourSide'),
                  value: t(role === 'seller' ? 'esc.side.seller' : 'esc.side.buyer'),
                },
                { label: t('esc.otherSide'), value: otherSide },
                {
                  label: t('esc.what'),
                  value: description.trim() ? <bdi dir="auto">{description.trim()}</bdi> : quiet,
                },
                {
                  label: t('esc.slip.fee'),
                  value: feePreview !== null ? formatUsd(feePreview) : quiet,
                },
                {
                  label: t('esc.slip.settlement'),
                  value: t(
                    settlement === 'buyer_vault' ? 'esc.settlement.vault' : 'esc.settlement.ship',
                  ),
                },
              ]}
              note={t('esc.feeOnYou')}
            />
          </aside>

          <div className="row request-form-actions">
            <Button
              variant="primary"
              icon={<IconUsers />}
              disabled={busy || !ready}
              onClick={() => void raise()}
            >
              {t('esc.raiseAction')}
            </Button>
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
                  <th scope="col" className="td-end">
                    {t('esc.col.value')}
                  </th>
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
                    <tr
                      key={d.id}
                      className="is-clickable"
                      tabIndex={0}
                      onClick={() => setOpenId(d.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpenId(d.id);
                        }
                      }}
                    >
                      <td data-label={t('esc.col.deal')} className="dt-primary">
                        <code dir="ltr">{d.code}</code>
                      </td>
                      <td data-label={t('esc.col.what')}>{d.description}</td>
                      <td data-label={t('esc.col.value')} className="td-end num">
                        <Amount>{formatUsd(d.valueMinor)}</Amount>
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
      onClose={onClose}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      <DrawerTag
        kicker={t('esc.col.value')}
        amount={formatUsd(deal.valueMinor)}
        status={<StatusBadge tone={ESCROW_TONE[deal.status] ?? 'neutral'}>{escrowStatusLabel(t, deal.status)}</StatusBadge>}
        note={t('esc.feeLine', { amount: formatUsd(deal.feeMinor) })}
      />

      <dl className="detail-list">
        <div className="detail-row">
          <dt className="detail-label">{t('esc.col.what')}</dt>
          <dd className="detail-value">
            <bdi dir="auto">{deal.description}</bdi>
          </dd>
        </div>
        <div className="detail-row">
          <dt className="detail-label">{t('esc.otherSide')}</dt>
          <dd className="detail-value">
            {deal.counterpartyUserId ? (
              t('esc.otherAccount')
            ) : (
              <>
                <bdi dir="auto">{deal.counterpartyName ?? '—'}</bdi> <bdi dir="ltr">({deal.counterpartyEmail ?? ''})</bdi>
              </>
            )}
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
            variant="primary"
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
            variant="primary"
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
                variant="primary"
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
      <ul className="timeline timeline--drawer">
        {events.map((e) => (
          <li key={e.id}>
            <span className="hint date">{formatDate(e.occurredAt, locale)}</span>
            <div className="register-text">
              <span className="register-kind">{escrowEventLabel(t, e, deal)}</span>
              {e.onBehalfOf && (
                <StatusBadge tone="neutral" plain>
                  {t('esc.onBehalf')}
                </StatusBadge>
              )}
              {e.notes && (
                <p className="register-entry">
                  <bdi dir="auto">{e.notes}</bdi>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </DetailDrawer>
  );
}
