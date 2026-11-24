import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { bpsToPercent, dollarsToCents, formatDate, formatUsd } from '../../../shared/money';
import {
  ESCROW_TONE,
  escrowEventLabel,
  escrowStatusLabel,
  nextStep,
  type EscrowDeal,
  type EscrowEvent,
} from '../../../shared/escrow';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  MoneyField,
  Panel,
  SkeletonBlock,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { isValidUsername } from '../../../shared/names';
import { typedUsername } from '../../../shared/market';
import { ListTools, LIST_TOOLS_FROM, byNewest, byNumber, useListView, type SortOption } from './ListTools';
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
}

export function EscrowTab() {
  const { t, locale } = useI18n();
  const [deals, setDeals] = useState<EscrowDeal[] | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [held, setHeld] = useState<{ heldMinor: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (name: string) => setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }));
  const view = useListView(deals, dealText, DEAL_SORTS);

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

  const emailBad = outsideEmail.trim() !== '' && !EMAIL.test(outsideEmail.trim());
  const usernameBad = username.trim() !== '' && !isValidUsername(typedUsername(username));
  const valueBad = value.trim() !== '' && cents === null;
  const missing =
    external && outsideName.trim() === ''
      ? t('escrow.need.name')
      : external && (outsideEmail.trim() === '' || emailBad)
        ? t('escrow.need.email')
        : !external && (username.trim() === '' || usernameBad)
          ? t('escrow.need.username')
          : description.trim() === ''
            ? t('escrow.need.what')
            : cents === null || belowFloor
              ? t('escrow.need.value')
              : null;

  const ready =
    !emailBad &&
    !usernameBad &&
    description.trim() !== '' &&
    cents !== null &&
    cents > 0 &&
    !belowFloor &&
    (external ? outsideName.trim() !== '' && outsideEmail.trim() !== '' : username.trim() !== '');

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
    setRaiseError(null);
    try {
      const deal = await api.post<EscrowDeal>('/escrow', {
        raiserRole: role,
        counterpartyUsername: external ? undefined : typedUsername(username),
        counterpartyName: external ? outsideName.trim() : undefined,
        counterpartyEmail: external ? outsideEmail.trim() : undefined,
        description: description.trim(),
        valueMinor: cents,
        settlement,
      });
      setStatus(
        t(external ? 'escrow.raisedExternal' : 'escrow.raised', {
          code: deal.code,
          who: external ? outsideEmail.trim() : `@${typedUsername(username)}`,
        }),
      );
      setError(null);
      setDescription('');
      setValue('');
      setTouched({});
      await load();
    } catch (e) {
      setRaiseError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status && <SuccessNote>{status}</SuccessNote>}

      <Panel title={t('esc.title')} subtitle={t('esc.subtitle')}>
        <p className="field-hint">{t('esc.how')}</p>
        {terms && (
          <p className="field-hint">
            {t('esc.terms', {
              percent: bpsToPercent(terms.feeBps),
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
            <Field label={t('esc.yourSide')}>
              <select value={role} onChange={(e) => setRole(e.target.value as 'buyer' | 'seller')}>
                <option value="seller">{t('esc.side.seller')}</option>
                <option value="buyer">{t('esc.side.buyer')}</option>
              </select>
            </Field>

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
                <Field label={t('esc.theirName')}>
                  <input
                    value={outsideName}
                    dir="auto"
                    autoComplete="off"
                    onChange={(e) => setOutsideName(e.target.value)}
                  />
                </Field>
                <Field
                  label={t('esc.theirEmail')}
                  hint={t('esc.externalHint')}
                  error={touched.email && emailBad ? t('escrow.emailBad') : undefined}
                >
                  <input
                    type="email"
                    value={outsideEmail}
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={(touched.email && emailBad) || undefined}
                    onBlur={() => touch('email')}
                    onChange={(e) => setOutsideEmail(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field
                label={t('esc.theirUsername')}
                hint={t('escrow.usernameHint')}
                error={touched.username && usernameBad ? t('market.propose.usernameBad') : undefined}
              >
                <input
                  value={username}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={(touched.username && usernameBad) || undefined}
                  onBlur={() => touch('username')}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
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
              onBlur={() => touch('value')}
              error={touched.value && valueBad ? t('market.sell.priceBad') : undefined}
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

          <div className="stack stack--tight request-form-actions">
            {raiseError && <ErrorState message={raiseError} />}
            <div className="row">
              <Button
                variant="primary"
                icon={<IconUsers />}
                disabled={busy || !ready}
                aria-describedby={missing ? 'escrow-missing' : undefined}
                onClick={() => void raise()}
              >
                {t('esc.raiseAction')}
              </Button>
            </div>
            <p className="field-hint" id="escrow-missing">
              {missing ?? t('escrow.raiseNext')}
            </p>
          </div>
        </div>
      </Panel>

      <Panel title={t('esc.mine')} subtitle={t('esc.mineSubtitle')} flush>
        {error ? (
          <ErrorState
            title={t('escrow.loadFailed')}
            message={error}
            onRetry={() => {
              setDeals(null);
              setError(null);
              void load();
            }}
            retryLabel={t('ui.retry')}
          />
        ) : deals === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : deals.length === 0 ? (
          <EmptyState title={t('esc.none')} text={t('escrow.noneNext')} icon={<IconShield />} />
        ) : (
          <>
          {deals.length > LIST_TOOLS_FROM && (
            <ListTools label={t('esc.mine')} view={view} sorts={DEAL_SORTS} total={deals.length} />
          )}
          {view.shown?.length === 0 && <EmptyState title={t('market.list.noMatch')} text={t('market.list.noMatchText')} />}
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
                {(view.shown ?? []).map((d) => (
                  <tr
                    key={d.id}
                    className="is-clickable"
                    tabIndex={0}
                    aria-label={t('escrow.openDeal', { code: d.code })}
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
                      {nextStep(t, d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {openId && (
        <DealDrawer
          dealId={openId}
          locale={locale}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onStatus={setStatus}
        />
      )}
    </>
  );
}

function DealDrawer({
  dealId,
  locale,
  onClose,
  onChanged,
  onStatus,
}: {
  dealId: string;
  locale: string;
  onClose: () => void;
  onChanged: () => void;
  onStatus: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'fund' | 'release' | 'return' | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<Detail>(`/escrow/${dealId}`));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await fn();
      onStatus(ok);
      setDone(ok);
      setConfirming(null);
      await load();
      onChanged();
    } catch (e) {
      setFailure((e as Error).message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <DetailDrawer
        title={t('esc.col.deal')}
        onClose={onClose}
        footer={
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        }
      >
        {loadError ? (
          <ErrorState message={loadError} onRetry={() => void load()} retryLabel={t('ui.retry')} />
        ) : (
          <SkeletonBlock className="skel-metric" />
        )}
      </DetailDrawer>
    );
  }
  const { deal, events } = detail;
  const iAmBuyer = deal.myRole === 'buyer';
  const iAmSeller = deal.myRole === 'seller';
  const fundMinor = deal.valueMinor + (deal.raiserRole === 'buyer' ? deal.feeMinor : 0);
  const mismatch = deal.inspectionMatches === 'no';
  const myRelease = iAmBuyer ? deal.buyerReleasedAt : deal.sellerReleasedAt;

  return (
    <>
    <DetailDrawer
      title={deal.code}
      onClose={onClose}
      dirty={reason.trim() !== ''}
      notice={failure ? <ErrorState message={failure} /> : done ? <SuccessNote>{done}</SuccessNote> : undefined}
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
            {deal.counterpartyIsMember ? (
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

      {deal.status === 'proposed' && !deal.raisedByMe && deal.counterpartyIsMember && (
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
            onClick={() => setConfirming('fund')}
          >
            {t('esc.fund', { amount: formatUsd(fundMinor) })}
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
                onClick={() => setConfirming('release')}
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
          <Field label={t('esc.returnReason')} hint={t('escrow.returnReasonHint')}>
            <input value={reason} maxLength={500} dir="auto" onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="row">
            <Button
              variant="danger"
              size="sm"
              disabled={busy || reason.trim() === ''}
              onClick={() => setConfirming('return')}
            >
              {t('esc.returnAction')}
            </Button>
            <span className="field-hint">{t('esc.returnHint')}</span>
          </div>
        </div>
      )}

      <h3 className="drawer-heading">{t('esc.trail')}</h3>
      <ul className="timeline timeline--drawer">
        {events.map((e, i) => (
          <li key={`${e.occurredAt}-${e.eventType}-${i}`}>
            <span className="hint date">{formatDate(e.occurredAt, locale)}</span>
            <div className="register-text">
              <span className="register-kind">{escrowEventLabel(t, e, deal)}</span>
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

    {confirming && (
      <ConfirmationModal
        title={t(
          confirming === 'fund'
            ? 'escrow.confirm.fundTitle'
            : confirming === 'release'
              ? 'escrow.confirm.releaseTitle'
              : 'escrow.confirm.returnTitle',
        )}
        body={
          <p>
            {t(
              confirming === 'fund'
                ? 'escrow.confirm.fundBody'
                : confirming === 'release'
                  ? 'escrow.confirm.releaseBody'
                  : 'escrow.confirm.returnBody',
              { amount: formatUsd(confirming === 'release' ? deal.valueMinor : fundMinor), code: deal.code },
            )}
          </p>
        }
        confirmLabel={t(
          confirming === 'fund'
            ? 'escrow.confirm.fund'
            : confirming === 'release'
              ? 'esc.release'
              : 'esc.returnAction',
        )}
        cancelLabel={t('ui.cancel')}
        tone={confirming === 'return' ? 'danger' : 'primary'}
        busy={busy}
        onConfirm={() =>
          void act(
            () =>
              confirming === 'return'
                ? api.post(`/escrow/${dealId}/return`, { reason })
                : api.post(`/escrow/${dealId}/${confirming}`, {}),
            t(confirming === 'fund' ? 'esc.funded' : confirming === 'release' ? 'esc.released' : 'esc.returned'),
          )
        }
        onCancel={() => setConfirming(null)}
      />
    )}
    </>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEAL_SORTS: readonly SortOption<EscrowDeal>[] = [
  { key: 'newest', label: 'market.sort.newest', compare: byNewest((d) => d.createdAt) },
  { key: 'value_desc', label: 'market.sort.amountDesc', compare: byNumber((d) => d.valueMinor, -1) },
];

const dealText = (d: EscrowDeal) => `${d.code} ${d.description} ${d.status} ${d.counterpartyName ?? ''} ${d.counterpartyEmail ?? ''}`;
