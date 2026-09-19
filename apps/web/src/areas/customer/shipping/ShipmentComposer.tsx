import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import {
  boxLabel,
  formatBoxDimensions,
  formatWeight,
  ruleLabel,
  serviceLabel,
  type Quote,
  type QuotedRate,
  type ServiceCatalogue,
} from '../../../shared/carriers';
import { Button, EmptyState, Field, MoneyField, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconAlert, IconBox, IconLocation, IconShipping } from '../../../shared/ui/icons';
import { navigate } from '../../../shared/routing';
import { countryName, useShippingCountries } from '../../../shared/countries';

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

interface VaultItem {
  id: string;
  typeClass: string;
  description: string;
}

/**
 * Building a parcel, and pricing it before committing to it.
 *
 * The old composer was four controls: tick some items, choose a saved address,
 * tick Rush, press a button — which created a shipment record and only THEN
 * showed two prices. There was no way to ask "what would this cost" without
 * committing, and the two prices were the same two prices for every parcel,
 * because nothing about the destination or the weight reached the rate request.
 *
 * The order of operations here is the substance of the change. Everything on the
 * left is a question about the parcel; the panel on the right re-quotes as those
 * answers change; and the shipment is only created once somebody has seen what
 * it costs. A service that cannot legally carry the parcel is still SHOWN, with
 * the rule it failed — an option that silently vanished would leave a collector
 * hunting for the cheap one they saw a moment ago.
 */
export function ShipmentComposer({
  items,
  onError,
  onStatus,
  onCreated,
}: {
  items: VaultItem[];
  onError: (message: string | null) => void;
  onStatus: (message: string | null) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();

  const [catalogue, setCatalogue] = useState<ServiceCatalogue | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [rush, setRush] = useState(false);
  const [insured, setInsured] = useState('');
  const [declared, setDeclared] = useState('');
  const [signature, setSignature] = useState(false);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [boxSize, setBoxSize] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([id]) => id),
    [selected],
  );

  const address = addresses.find((a) => a.id === addressId);
  const international = Boolean(address && address.country.toUpperCase() !== 'US');
  const insuredMinor = dollarsToCents(insured) ?? 0;
  const declaredMinor = dollarsToCents(declared) ?? 0;

  // The signature is not merely validated — it is FORCED, because the cover
  // would not pay on a parcel left at a door. Showing it ticked and locked is
  // more honest than refusing the combination at submit time.
  const signatureForced =
    catalogue !== null && insuredMinor > catalogue.signatureRequiredAboveMinor;
  const effectiveSignature = signature || signatureForced;

  useEffect(() => {
    void (async () => {
      try {
        const [cat, list] = await Promise.all([
          api.get<ServiceCatalogue>('/shipping/services'),
          api.get<Address[]>('/me/addresses'),
        ]);
        setCatalogue(cat);
        setAddresses(list);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (preferred) setAddressId(preferred.id);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  const body = useCallback(
    () => ({
      itemIds: selectedIds,
      addressId,
      rush,
      insuredValueMinor: insuredMinor,
      declaredValueMinor: declaredMinor,
      signatureRequired: effectiveSignature,
      addOns,
      customerNotes: notes.trim() || undefined,
      boxSize: boxSize || null,
    }),
    [selectedIds, addressId, rush, insuredMinor, declaredMinor, effectiveSignature, addOns, notes, boxSize],
  );

  /**
   * Re-quote as the answers change, debounced.
   *
   * Quoting is free and creates nothing, so there is no reason to make somebody
   * press a button to find out that adding insurance changed the price.
   */
  useEffect(() => {
    if (selectedIds.length === 0 || !addressId) {
      setQuote(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        setQuoting(true);
        try {
          setQuote(await api.post<Quote>('/shipping/quote', body()));
          onError(null);
        } catch (e) {
          setQuote(null);
          onError((e as Error).message);
        } finally {
          setQuoting(false);
        }
      })();
    }, 350);
    return () => clearTimeout(handle);
  }, [selectedIds.length, addressId, body, onError]);

  function toggleItem(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAddOn(key: string) {
    setAddOns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  /** Create the request, then take the chosen service in the same gesture. */
  async function commit(rate: QuotedRate | 'recommended') {
    setBusy(true);
    try {
      const created = await api.post<{ id: string; code?: string }>('/shipping/shipments', body());
      const result =
        rate === 'recommended'
          ? await api.post<{ status: string; cost: number; shortfallMinor?: number }>(
              `/shipping/shipments/${created.id}/choose-for-me`,
            )
          : await api.post<{ status: string; cost: number; shortfallMinor?: number }>(
              `/shipping/shipments/${created.id}/select-rate`,
              { carrier: rate.carrier, serviceLevel: rate.serviceLevel },
            );

      onCreated();
      onStatus(
        result.status === 'awaiting_payment'
          ? t('ship.heldForPayment', {
              id: created.code ?? created.id,
              amount: formatUsd(result.shortfallMinor ?? 0),
              days: catalogue?.paymentWindowDays ?? 7,
            })
          : t('ship.booked', { id: created.code ?? created.id, amount: formatUsd(result.cost) }),
      );
      onError(null);
      setSelected({});
      setQuote(null);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const eligible = (quote?.rates ?? []).filter((r) => r.eligible);
  const refused = (quote?.rates ?? []).filter((r) => !r.eligible);
  const blocked = (quote?.optionProblems ?? []).length > 0;

  return (
    <>
      <Panel
        title={t('shipping.selectItems')}
        subtitle={t('shipping.selectItemsSubtitle')}
        tools={
          selectedIds.length > 0 ? (
            <StatusBadge tone="info">{t('shipping.selectedCount', { count: selectedIds.length })}</StatusBadge>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState title={t('shipping.noItems')} text={t('shipping.noItemsText')} icon={<IconBox />} />
        ) : (
          <ul className="check-list">
            {items.map((item) => (
              <li key={item.id}>
                <label className="check">
                  <input type="checkbox" checked={!!selected[item.id]} onChange={() => toggleItem(item.id)} />
                  <span>
                    {item.typeClass} — {item.description}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('shipping.destination')} subtitle={t('shipping.destinationSubtitle')}>
        {addresses.length === 0 ? (
          /*
            This told somebody to go and manage their addresses and gave them no
            way to do it — the form lives on another section entirely, and
            nothing on screen said which. A shipment cannot be composed at all
            from here without one, so this is the only thing to do next.
          */
          <EmptyState
            title={t('shipping.noAddresses')}
            text={t('shipping.manageAddressesHint')}
            icon={<IconLocation />}
            action={
              <Button
                size="sm"
                variant="gold"
                onClick={() => navigate({ section: 'profile', tab: 'addresses' })}
              >
                {t('shipping.addAnAddress')}
              </Button>
            }
          />
        ) : (
          <div className="stack stack--tight" style={{ maxWidth: 620 }}>
            <Field
              label={t('shipping.addressPlaceholder')}
              hint={t('shipping.manageAddressesHint')}
            >
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                <option value="">{t('shipping.addressPlaceholder')}</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}: {a.recipient}, {a.line1}, {a.city} {a.postalCode},{' '}
                    {countryName(a.country, countries)}
                  </option>
                ))}
              </select>
            </Field>

            {/* The box changes the price — a carrier bills on size as well as
                weight — so it is asked here, before the quote, not at the packing
                bench after the price was already given. */}
            <Field label={t('ship.boxSize')} hint={t('ship.boxSizeHint')}>
              <select value={boxSize} onChange={(e) => setBoxSize(e.target.value)}>
                <option value="">{t('ship.box.none')}</option>
                {(catalogue?.boxes ?? []).map((b) => (
                  <option key={b.key} value={b.key}>
                    {boxLabel(t, b)} — {formatBoxDimensions(b)},{' '}
                    {t('ship.boxUpTo', { weight: formatWeight(b.maxContentsGrams) })}
                  </option>
                ))}
              </select>
            </Field>

            <label className="check">
              <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} />
              {t('shipping.rush')}
            </label>
            <span className="field-hint">{t('ship.rushHint')}</span>
          </div>
        )}
      </Panel>

      <Panel title={t('ship.protection')} subtitle={t('ship.protectionSubtitle')}>
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
          <MoneyField
            label={t('ship.insuredValue')}
            value={insured}
            onChange={setInsured}
            hint={
              catalogue
                ? t('ship.insuredHint', {
                    max: formatUsd(catalogue.maxInsuredValueMinor),
                    threshold: formatUsd(catalogue.signatureRequiredAboveMinor),
                  })
                : undefined
            }
          />

          <label className="check">
            <input
              type="checkbox"
              checked={effectiveSignature}
              disabled={signatureForced}
              onChange={(e) => setSignature(e.target.checked)}
            />
            {t('ship.signature')}
          </label>
          {signatureForced && <span className="field-hint">{t('ship.signatureForced')}</span>}

          {international && (
            <MoneyField
              label={t('ship.customsValue')}
              value={declared}
              onChange={setDeclared}
              hint={t('ship.customsHint')}
            />
          )}

          {(catalogue?.addOns ?? []).map((a) => (
            <div key={a.key}>
              <label className="check">
                <input type="checkbox" checked={addOns.includes(a.key)} onChange={() => toggleAddOn(a.key)} />
                {t('ship.addon.gps_tracker')} — {formatUsd(a.priceMinor)}
              </label>
              <span className="field-hint">
                {t('ship.addonNeedsInsurance', { amount: formatUsd(a.requiresInsuranceMinor) })}
              </span>
            </div>
          ))}

          <Field label={t('ship.notes')} hint={t('ship.notesHint')}>
            <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel
        title={t('ship.quote')}
        subtitle={
          quote
            ? t('ship.quoteSubtitle', {
                count: quote.itemCount,
                weight: formatWeight(quote.totalWeightGrams),
                country: quote.destination.country,
              })
            : t('ship.quoteEmptySubtitle')
        }
        tools={quoting ? <StatusBadge tone="info">{t('ship.quoting')}</StatusBadge> : undefined}
      >
        {!quote ? (
          <EmptyState title={t('ship.quoteEmpty')} text={t('ship.quoteEmptyText')} icon={<IconShipping />} />
        ) : (
          <>
            {quote.weightEstimated && <p className="field-hint">{t('ship.weightEstimated')}</p>}
            <p className="field-hint">
              {quote.boxSize
                ? t('ship.pricedInBox', { box: boxLabel(t, { key: quote.boxSize }) })
                : t('ship.pricedOnWeight')}
            </p>

            {quote.optionProblems.map((p) => (
              <p key={p.field} className="drawer-note drawer-note--hold">
                <IconAlert />
                <span>
                  {p.rule === 'box_weight'
                    ? t('ship.boxTooHeavy')
                    : p.rule === 'box_contents'
                      ? t('ship.boxWrongContents')
                      : p.message}
                </span>
              </p>
            ))}

            {eligible.length === 0 ? (
              <EmptyState title={t('ship.noneEligible')} text={t('ship.noneEligibleText')} icon={<IconAlert />} />
            ) : (
              <ul className="card-grid">
                {eligible.map((r) => (
                  <li key={r.serviceKey} className={`card${r.recommended ? ' card--accent' : ''}`}>
                    <h3 className="card-title">{serviceLabel(t, r)}</h3>
                    <p className="card-desc">
                      {t('ship.transit', { min: r.transitDaysMin, max: r.transitDaysMax })}
                    </p>
                    <p className="price" dir="ltr">
                      {formatUsd(r.totalMinor)}
                    </p>
                    <p className="hint" dir="ltr">
                      {t('ship.breakdown', {
                        carrier: formatUsd(r.costMinor),
                        handling: formatUsd(r.handlingMinor),
                        insurance: formatUsd(r.insurancePremiumMinor),
                      })}
                    </p>
                    {/* The tier's part, named. A total that is lower than the
                        breakdown above it, with nothing to say why, reads as a
                        mistake — so the membership says what it paid. */}
                    {r.membershipCover && (r.coveredMinor ?? 0) > 0 && (
                      <p className="hint mem-covered">
                        {t('ship.coveredBy', {
                          tier: t(`membership.tier.${r.membershipCover.tier}` as MessageKey),
                          amount: formatUsd(r.coveredMinor ?? 0),
                        })}
                      </p>
                    )}
                    {r.recommended && <StatusBadge tone="gold">{t('ship.recommended')}</StatusBadge>}
                    <div className="actions">
                      <Button
                        variant={r.recommended ? 'gold' : 'secondary'}
                        size="sm"
                        block
                        disabled={busy || blocked}
                        onClick={() => void commit(r)}
                      >
                        {t('shipping.selectRate')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {eligible.length > 0 && (
              <div className="row stack-top">
                <Button
                  variant="gold"
                  icon={<IconShipping />}
                  disabled={busy || blocked}
                  onClick={() => void commit('recommended')}
                >
                  {t('ship.chooseForMe')}
                </Button>
                <span className="field-hint">{t('ship.chooseForMeHint')}</span>
              </div>
            )}

            {/* Refused services stay on screen with their reason. A collector who
                wanted the cheap one is owed the rule, not a gap where it was. */}
            {refused.length > 0 && (
              <>
                <h3 className="drawer-heading">{t('ship.unavailable')}</h3>
                <ul className="check-list list-unbounded">
                  {refused.map((r) => (
                    <li key={r.serviceKey}>
                      <span>
                        {serviceLabel(t, r)}
                        <span className="hint" dir="ltr">
                          {' '}
                          {formatUsd(r.totalMinor)}
                        </span>
                      </span>
                      <span className="hint">{r.problems.map((p) => ruleLabel(t, p)).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
