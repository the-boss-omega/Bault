import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { itemName } from '../../../shared/itemClasses';
import { centsToDollars, dollarsToCents, formatUsd } from '../../../shared/money';
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
import { Button, ButtonLink, ErrorState, Field, MoneyField, StatusBadge } from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { TierPrice } from '../../../shared/ui/TierPrice';
import { IconAlert, IconChevronRight, IconPlus, IconShipping, IconUsers } from '../../../shared/ui/icons';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import { countryName, lacksRegion, useShippingCountries } from '../../../shared/countries';
import {
  AddressFields,
  EMPTY_ADDRESS,
  addressOptionals,
  missingAddressFields,
  type Address,
  type AddressDraft,
} from '../profile/AddressFields';
import { CardPicker, cardCountLabel, transitLabel, useClaimedItems, type PickableItem } from './CardPicker';

const STEPS = ['cards', 'where', 'how', 'review'] as const;
type Step = (typeof STEPS)[number];

const STEP_LABEL: Record<Step, MessageKey> = {
  cards: 'ship.step.cards',
  where: 'ship.step.where',
  how: 'ship.step.how',
  review: 'ship.step.review',
};

interface DestinationGuidance {
  universal: string[];
  specific: {
    name: string;
    authority: { name: string; url: string };
    notes: string[];
    notHandled: string[];
  } | null;
}

interface SelectResult {
  status: string;
  cost: number;
  shortfallMinor?: number;
}

type Done =
  | { kind: 'booked'; id: string; code: string; costMinor: number; rate: QuotedRate }
  | { kind: 'held'; id: string; code: string; costMinor: number; shortfallMinor: number; rate: QuotedRate }
  | { kind: 'shared'; id: string; code: string; groupCode: string | null; opened: boolean }
  | { kind: 'unfinished'; id: string; code: string; reason: string; shared: boolean };

interface SharedChoice {
  on: boolean;
  mode: 'open' | 'join';
  code: string;
  notes: string;
}

const GROUP_CODE = /^GRP-[A-Z0-9]{4,}$/i;

export function ShipmentComposer({ items, onCreated }: { items: PickableItem[]; onCreated: () => void }) {
  const [round, setRound] = useState(0);
  return (
    <ComposerRound key={round} items={items} onCreated={onCreated} onAgain={() => setRound((r) => r + 1)} />
  );
}

function ComposerRound({
  items,
  onCreated,
  onAgain,
}: {
  items: PickableItem[];
  onCreated: () => void;
  onAgain: () => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const route = useRoute();
  const { setParams } = useNavigation(route);
  const claimed = useClaimedItems();

  const [step, setStep] = useState<Step>('cards');
  const [catalogue, setCatalogue] = useState<ServiceCatalogue | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [addressId, setAddressId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [insured, setInsured] = useState<string | null>(null);
  const [signature, setSignature] = useState(false);
  const [rush, setRush] = useState(false);
  const [addOns, setAddOns] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [boxSize, setBoxSize] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [serviceKey, setServiceKey] = useState<string | null>(null);
  const [shared, setShared] = useState<SharedChoice>({ on: false, mode: 'open', code: '', notes: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [refusedAddressId, setRefusedAddressId] = useState<string | null>(null);
  const [tried, setTried] = useState<Partial<Record<Step, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [guidance, setGuidance] = useState<DestinationGuidance | null>(null);

  const [newAddress, setNewAddress] = useState<AddressDraft | null>(null);
  const [newAddressTried, setNewAddressTried] = useState(false);
  const [newAddressError, setNewAddressError] = useState<string | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);

  const stepHeading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const heading = stepHeading.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.closest('.composer')?.scrollIntoView?.({ block: 'start' });
  }, [step]);

  const preselect = route.params.items;
  const consumed = useRef(false);
  useEffect(() => {
    if (!preselect || consumed.current) return;
    consumed.current = true;
    setPicked(new Set(preselect.split(',').filter(Boolean)));
    setParams({ items: null });
  }, [preselect, setParams]);

  const [loadRound, setLoadRound] = useState(0);
  useEffect(() => {
    void (async () => {
      try {
        const [cat, list] = await Promise.all([
          api.get<ServiceCatalogue>('/shipping/services'),
          api.get<Address[]>('/me/addresses'),
        ]);
        setCatalogue(cat);
        setAddresses(list);
        setLoadError(null);
        const preferred = list.find((a) => a.isDefault) ?? list[0];
        if (preferred) setAddressId((cur) => cur || preferred.id);
        else setNewAddress((cur) => cur ?? { ...EMPTY_ADDRESS });
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [loadRound]);

  useEffect(() => {
    void api
      .get<{ amount: number }>('/finance/wallet')
      .then((wallet) => setBalanceMinor(typeof wallet?.amount === 'number' ? wallet.amount : null))
      .catch(() => setBalanceMinor(null));
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedIds = useMemo(
    () => Array.from(picked).filter((id) => byId.has(id) && !claimed.has(id)),
    [picked, byId, claimed],
  );
  const selectedItems = selectedIds.map((id) => byId.get(id)!);

  const address = (addresses ?? []).find((a) => a.id === addressId);
  const regionMissing = Boolean(
    address && (lacksRegion(address, countries) || refusedAddressId === address.id),
  );
  const international = Boolean(address && address.country.toUpperCase() !== 'US');

  const valueMinor = (id: string) => dollarsToCents(values[id] ?? '') ?? 0;
  const valueInvalid = (id: string) => (values[id] ?? '').trim() !== '' && dollarsToCents(values[id]!) === null;
  const valuesTotal = selectedIds.reduce((sum, id) => sum + valueMinor(id), 0);
  const insuredText = insured ?? (valuesTotal > 0 ? centsToDollars(valuesTotal) : '');
  const insuredMinor = dollarsToCents(insuredText) ?? 0;
  const declaredMinor = international ? valuesTotal : 0;
  const missingValues = international ? selectedIds.filter((id) => valueMinor(id) <= 0) : [];

  const signatureForced = catalogue !== null && insuredMinor > catalogue.signatureRequiredAboveMinor;
  const effectiveSignature = signature || signatureForced;

  const perItemCustomsValues = useMemo(() => {
    if (!international) return undefined;
    const entries = selectedIds
      .map((id) => [id, dollarsToCents(values[id] ?? '') ?? 0] as const)
      .filter(([, minor]) => minor > 0);
    return Object.fromEntries(entries);
  }, [international, selectedIds, values]);

  const body = useMemo(
    () => ({
      itemIds: selectedIds,
      addressId,
      rush,
      insuredValueMinor: insuredMinor,
      declaredValueMinor: declaredMinor,
      perItemCustomsValues,
      signatureRequired: effectiveSignature,
      addOns,
      customerNotes: notes.trim() || undefined,
      boxSize: boxSize || null,
    }),
    [selectedIds, addressId, rush, insuredMinor, declaredMinor, perItemCustomsValues, effectiveSignature, addOns, notes, boxSize],
  );

  useEffect(() => {
    if (selectedIds.length === 0 || !addressId || regionMissing) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let live = true;
    const handle = setTimeout(() => {
      void (async () => {
        setQuoting(true);
        try {
          const next = await api.post<Quote>('/shipping/quote', body);
          if (!live) return;
          setQuote(next);
          setQuoteError(null);
        } catch (e) {
          if (!live) return;
          setQuote(null);
          if (refusedForRegion(e)) setRefusedAddressId(addressId);
          else setQuoteError((e as Error).message);
        } finally {
          if (live) setQuoting(false);
        }
      })();
    }, 350);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [selectedIds.length, addressId, regionMissing, body]);

  const country = address?.country;
  useEffect(() => {
    if (!country || country.toUpperCase() === 'US') {
      setGuidance(null);
      return;
    }
    let live = true;
    void api
      .get<DestinationGuidance>(`/shipping/destinations/${encodeURIComponent(country)}`)
      .then((g) => {
        if (live) setGuidance(g && Array.isArray(g.universal) ? g : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [country]);

  const eligible = (quote?.rates ?? []).filter((r) => r.eligible);
  const refused = (quote?.rates ?? []).filter((r) => !r.eligible);
  const recommended = eligible.find((r) => r.recommended) ?? eligible[0];
  const chosen = eligible.find((r) => r.serviceKey === serviceKey) ?? recommended;
  const problems = quote?.optionProblems ?? [];
  const problemFor = (field: string) => problems.find((p) => p.field === field);
  const problemText = (p: { field: string; message: string; rule?: string }) =>
    p.rule === 'box_weight' ? t('ship.boxTooHeavy') : p.rule === 'box_contents' ? t('ship.boxWrongContents') : p.message;
  const extrasProblem = Boolean(problemFor('boxSize') || problemFor('addOns'));

  const why = noPriceReason();
  function noPriceReason(): string | null {
    if (selectedIds.length === 0) return t('ship.why.noCards');
    if (!address) return t('ship.why.noAddress');
    if (regionMissing) return t('ship.why.region', { label: address.label });
    if (quoteError) return quoteError;
    if (missingValues.length > 0) return t('ship.why.values');
    if (!quote) return t('ship.quoting');
    if (problems.length > 0) return problemText(problems[0]!);
    if (shared.on) return null;
    if (eligible.length === 0) {
      const reasons = Array.from(new Set(refused.flatMap((r) => r.problems.map((p) => ruleLabel(t, p)))));
      return reasons.length > 0 ? t('ship.why.noCarrierBecause', { reasons: reasons.join('; ') }) : t('ship.noneEligible');
    }
    return null;
  }

  const sharedCodeOk = !shared.on || shared.mode === 'open' || GROUP_CODE.test(shared.code.trim());
  const blockers: Record<Step, string | null> = {
    cards: selectedIds.length === 0 ? t('ship.why.noCards') : null,
    where: !address
      ? t('ship.why.noAddress')
      : regionMissing
        ? t('ship.why.region', { label: address.label })
        : !sharedCodeOk
          ? t('ship.shared.codeNeeded')
          : null,
    how: why,
    review: why,
  };

  const reachable = (target: Step) => {
    const index = STEPS.indexOf(target);
    return STEPS.slice(0, index).every((s) => blockers[s] === null);
  };

  function next() {
    setTried((prev) => ({ ...prev, [step]: true }));
    if (blockers[step] !== null) return;
    const index = STEPS.indexOf(step);
    if (index < STEPS.length - 1) setStep(STEPS[index + 1]!);
  }

  function back() {
    const index = STEPS.indexOf(step);
    if (index > 0) setStep(STEPS[index - 1]!);
  }

  function toggleCard(id: string) {
    setPicked((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }

  async function saveAddress() {
    if (!newAddress) return;
    setNewAddressTried(true);
    if (missingAddressFields(newAddress, countries).length > 0) return;
    setSavingAddress(true);
    try {
      const created = await api.post<Address>('/me/addresses', {
        ...newAddress,
        region: newAddress.region?.trim() || null,
        ...addressOptionals(newAddress),
      });
      const list = await api.get<Address[]>('/me/addresses').catch(() => null);
      setAddresses(list ?? [...(addresses ?? []), created]);
      if (created?.id) setAddressId(created.id);
      setNewAddress(null);
      setNewAddressTried(false);
      setNewAddressError(null);
    } catch (e) {
      setNewAddressError((e as Error).message);
    } finally {
      setSavingAddress(false);
    }
  }

  async function book() {
    setTried((prev) => ({ ...prev, review: true }));
    if (blockers.review !== null) return;
    if (!shared.on && !chosen) return;
    setBusy(true);
    setBookError(null);
    let created: { id: string; code?: string | null };
    try {
      created = await api.post<{ id: string; code?: string | null }>('/shipping/shipments', body);
    } catch (e) {
      if (refusedForRegion(e)) {
        setRefusedAddressId(addressId);
        setStep('where');
      } else {
        setBookError((e as Error).message);
      }
      setBusy(false);
      return;
    }
    const code = created.code ?? created.id;
    try {
      if (shared.on) {
        if (shared.mode === 'open') {
          const group = await api.post<{ code?: string }>('/shipping/groups', {
            shipmentId: created.id,
            notes: shared.notes.trim() || undefined,
          });
          setDone({ kind: 'shared', id: created.id, code, groupCode: group?.code ?? null, opened: true });
        } else {
          await api.post('/shipping/groups/join', { groupCode: shared.code.trim(), shipmentId: created.id });
          setDone({ kind: 'shared', id: created.id, code, groupCode: shared.code.trim().toUpperCase(), opened: false });
        }
      } else {
        const rate = chosen!;
        const result = await api.post<SelectResult>(`/shipping/shipments/${created.id}/select-rate`, {
          carrier: rate.carrier,
          serviceLevel: rate.serviceLevel,
        });
        setDone(
          result.status === 'awaiting_payment'
            ? {
                kind: 'held',
                id: created.id,
                code,
                costMinor: result.cost,
                shortfallMinor: result.shortfallMinor ?? 0,
                rate,
              }
            : { kind: 'booked', id: created.id, code, costMinor: result.cost, rate },
        );
      }
    } catch (e) {
      setDone({ kind: 'unfinished', id: created.id, code, reason: (e as Error).message, shared: shared.on });
    } finally {
      setBusy(false);
      onCreated();
    }
  }

  if (done) return <Confirmation done={done} t={t} paymentWindowDays={catalogue?.paymentWindowDays ?? 7} onAgain={onAgain} />;

  const amount = !shared.on && chosen ? <RatePrice rate={chosen} /> : '—';
  const destinationText = address ? (
    <bdi dir="auto">
      {address.city}, {countryName(address.country, countries)}
    </bdi>
  ) : null;

  const yes = t('ship.yes');
  const runningLines = [
    ...(selectedIds.length > 0 ? [{ label: t('ship.line.cards'), value: String(selectedIds.length) }] : []),
    ...(address ? [{ label: t('shipping.destination'), value: destinationText }] : []),
    ...(boxSize && catalogue?.boxes.find((b) => b.key === boxSize)
      ? [{ label: t('ship.boxSize'), value: boxLabel(t, { key: boxSize }) }]
      : []),
    ...(rush ? [{ label: t('shipping.rush'), value: yes }] : []),
    ...(insuredMinor > 0 ? [{ label: t('ship.insuredValue'), value: formatUsd(insuredMinor) }] : []),
    ...(international && declaredMinor > 0 ? [{ label: t('ship.customsDeclared'), value: formatUsd(declaredMinor) }] : []),
    ...(effectiveSignature ? [{ label: t('ship.signature'), value: yes }] : []),
    ...(shared.on ? [{ label: t('ship.shared.line'), value: shared.mode === 'open' ? t('ship.shared.youOpen') : shared.code.trim() || '—' }] : []),
  ];
  const slipNote = shared.on
    ? (why ?? t('ship.shared.slipNote'))
    : (why ?? (chosen ? `${serviceLabel(t, chosen)} · ${transitLabel(t, chosen.transitDaysMin, chosen.transitDaysMax)}` : ''));

  const stepIndex = STEPS.indexOf(step);
  const showTried = Boolean(tried[step]);
  const barReason = showTried ? blockers[step] : null;

  return (
    <div className={`composer composer--steps composer--at-${step}`}>
      <nav className="composer-steps" aria-label={t('ship.steps')}>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-current' : undefined}>
              <button
                type="button"
                aria-current={s === step ? 'step' : undefined}
                disabled={s !== step && !reachable(s)}
                onClick={() => setStep(s)}
              >
                <span className="composer-step-number" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="composer-step-name">{t(STEP_LABEL[s])}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="panel composer-step" aria-labelledby={`composer-step-${step}`}>
        <header className="panel-head">
          <div>
            <h2 className="panel-title" id={`composer-step-${step}`} tabIndex={-1} ref={stepHeading}>
              {t('ship.stepTitle', { n: stepIndex + 1, name: t(STEP_LABEL[step]) })}
            </h2>
            <p className="panel-subtitle">{t(`ship.stepSubtitle.${step}` as MessageKey)}</p>
          </div>
          {step === 'cards' && selectedIds.length > 0 && (
            <div className="panel-tools">
              <StatusBadge tone="info">{t('shipping.selectedCount', { count: selectedIds.length })}</StatusBadge>
            </div>
          )}
        </header>

        <div className="panel-body">
          {loadError && (
            <ErrorState
              title={t('ship.loadFailed')}
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                setLoadRound((n) => n + 1);
              }}
              retryLabel={t('ui.retry')}
            />
          )}

          {step === 'cards' && (
            <CardPicker
              items={items}
              selected={picked}
              onToggle={toggleCard}
              claimed={claimed}
              legend={t('shipping.selectItems')}
            />
          )}

          {step === 'where' && (
            <div className="stack">
              {addresses === null ? (
                !loadError && <p className="hint">{t('grp.loading')}</p>
              ) : (
                addresses.length > 0 && (
                  <fieldset className="address-choices">
                    <legend className="field-label">{t('ship.where.saved')}</legend>
                    <ul>
                      {addresses.map((a) => (
                        <li key={a.id}>
                          <label className={`address-choice${a.id === addressId ? ' is-on' : ''}`}>
                            <input
                              type="radio"
                              name="composer-address"
                              checked={a.id === addressId}
                              onChange={() => setAddressId(a.id)}
                            />
                            <span className="address-choice-text">
                              <span className="address-choice-label">
                                <bdi dir="auto">{a.label}</bdi>
                                {a.isDefault && <StatusBadge tone="gold">{t('profile.addresses.default')}</StatusBadge>}
                                {lacksRegion(a, countries) && (
                                  <StatusBadge tone="warning">{t('profile.addresses.regionMissing')}</StatusBadge>
                                )}
                              </span>
                              <bdi dir="auto" className="address-choice-recipient">
                                {a.recipient}
                              </bdi>
                              <bdi dir="auto">{a.line1}</bdi>
                              {a.line2 && <bdi dir="auto">{a.line2}</bdi>}
                              <bdi dir="auto">
                                {[a.city, a.region].filter(Boolean).join(', ')} {a.postalCode}
                              </bdi>
                              <span>{countryName(a.country, countries)}</span>
                              {a.phone && <span dir="ltr">{a.phone}</span>}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )
              )}

              {regionMissing && address && (
                <div className="field-error-block" role="alert">
                  <p className="field-error">
                    {t('shipping.regionMissing', {
                      label: address.label,
                      country: countryName(address.country, countries),
                    })}
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => navigate({ section: 'profile', tab: 'addresses' })}>
                    {t('shipping.editAddress')}
                  </Button>
                </div>
              )}

              {newAddress ? (
                <fieldset className="composer-new-address">
                  <legend className="field-label">{t('ship.where.newTitle')}</legend>
                  <p className="field-hint">{t('ship.where.newHint')}</p>
                  <AddressFields draft={newAddress} onChange={setNewAddress} />
                  {newAddressTried && missingAddressFields(newAddress, countries).length > 0 && (
                    <p className="field-error" role="alert">
                      {t('ship.where.stillNeeded', {
                        fields: missingAddressFields(newAddress, countries)
                          .map((k) => t(k))
                          .join(', '),
                      })}
                    </p>
                  )}
                  {newAddressError && (
                    <p className="field-error" role="alert">
                      <bdi dir="auto">{newAddressError}</bdi>
                    </p>
                  )}
                  <div className="row">
                    <Button variant="primary" icon={<IconPlus />} loading={savingAddress} onClick={() => void saveAddress()}>
                      {t('ship.where.save')}
                    </Button>
                    {(addresses ?? []).length > 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setNewAddress(null);
                          setNewAddressTried(false);
                          setNewAddressError(null);
                        }}
                      >
                        {t('profile.address.cancel')}
                      </Button>
                    )}
                  </div>
                </fieldset>
              ) : (
                <div>
                  <Button variant="secondary" icon={<IconPlus />} onClick={() => setNewAddress({ ...EMPTY_ADDRESS })}>
                    {t('ship.where.new')}
                  </Button>
                </div>
              )}

              <div className="composer-shared">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={shared.on}
                    onChange={(e) => setShared((s) => ({ ...s, on: e.target.checked }))}
                  />
                  {t('ship.shared.toggle')}
                </label>
                <span className="field-hint">{t('ship.shared.hint')}</span>
                {shared.on && (
                  <div className="stack stack--tight composer-shared-body">
                    <label className="check">
                      <input
                        type="radio"
                        name="composer-shared-mode"
                        checked={shared.mode === 'open'}
                        onChange={() => setShared((s) => ({ ...s, mode: 'open' }))}
                      />
                      {t('ship.shared.open')}
                    </label>
                    {shared.mode === 'open' && (
                      <Field label={t('grp.notes')} hint={t('grp.notesHint')}>
                        <input
                          value={shared.notes}
                          maxLength={500}
                          dir="auto"
                          onChange={(e) => setShared((s) => ({ ...s, notes: e.target.value }))}
                        />
                      </Field>
                    )}
                    <label className="check">
                      <input
                        type="radio"
                        name="composer-shared-mode"
                        checked={shared.mode === 'join'}
                        onChange={() => setShared((s) => ({ ...s, mode: 'join' }))}
                      />
                      {t('ship.shared.join')}
                    </label>
                    {shared.mode === 'join' && (
                      <Field
                        label={t('grp.code')}
                        hint={t('grp.sameAddressHint')}
                        error={showTried && !sharedCodeOk ? t('ship.shared.codeNeeded') : undefined}
                      >
                        <input
                          value={shared.code}
                          dir="ltr"
                          placeholder="GRP-XXXXXXXX"
                          onChange={(e) => setShared((s) => ({ ...s, code: e.target.value }))}
                        />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'how' && (
            <div className="stack">
              {!shared.on && (
                <ServiceChoice
                  t={t}
                  quote={quote}
                  quoting={quoting}
                  quoteError={quoteError}
                  eligible={eligible}
                  refused={refused}
                  chosen={chosen}
                  onChoose={setServiceKey}
                />
              )}

              <fieldset className="composer-values">
                <legend className="field-label">{t('ship.values.title')}</legend>
                <p className="field-hint">{international ? t('ship.values.hintAbroad') : t('ship.values.hint')}</p>
                <ul className="composer-value-list">
                  {selectedItems.map((item) => (
                    <li key={item.id}>
                      <MoneyField
                        label={
                          <>
                            <span dir="ltr">{item.serialNumber ?? ''}</span>{' '}
                            <span className="hint">{itemName(t, item)}</span>
                          </>
                        }
                        value={values[item.id] ?? ''}
                        onChange={(v) => setValues((prev) => ({ ...prev, [item.id]: v }))}
                        error={
                          valueInvalid(item.id)
                            ? t('ship.values.invalid')
                            : showTried && international && valueMinor(item.id) <= 0
                              ? t('ship.values.neededAbroad')
                              : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
                {problemFor('customsValueMinor') && missingValues.length === 0 && (
                  <p className="field-error" role="alert">
                    {problemText(problemFor('customsValueMinor')!)}
                  </p>
                )}
                {international && valuesTotal > 0 && (
                  <p className="field-hint">{t('ship.values.customsTotal', { amount: formatUsd(valuesTotal) })}</p>
                )}
              </fieldset>

              <MoneyField
                label={t('ship.insuredValue')}
                value={insuredText}
                onChange={setInsured}
                error={problemFor('insuredValueMinor') ? problemText(problemFor('insuredValueMinor')!) : undefined}
                hint={
                  catalogue
                    ? `${insured === null && valuesTotal > 0 ? `${t('ship.insuredFollows')} ` : ''}${t('ship.insuredHint', {
                        max: formatUsd(catalogue.maxInsuredValueMinor),
                        threshold: formatUsd(catalogue.signatureRequiredAboveMinor),
                      })}`
                    : undefined
                }
              />

              <div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={effectiveSignature}
                    disabled={signatureForced}
                    onChange={(e) => setSignature(e.target.checked)}
                  />
                  {t('ship.signature')}
                </label>
                {problemFor('signatureRequired') ? (
                  <p className="field-error">{problemText(problemFor('signatureRequired')!)}</p>
                ) : (
                  signatureForced && <span className="field-hint">{t('ship.signatureForced')}</span>
                )}
              </div>

              {international && <DutiesNotice t={t} guidance={guidance} />}

              <details
                className="composer-extras"
                open={extrasOpen || extrasProblem}
                onToggle={(e) => setExtrasOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>{t('ship.extras')}</summary>
                <div className="stack stack--tight">
                  <Field
                    label={t('ship.boxSize')}
                    hint={t('ship.boxSizeHint')}
                    error={problemFor('boxSize') ? problemText(problemFor('boxSize')!) : undefined}
                  >
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

                  <div>
                    <label className="check">
                      <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} />
                      {t('shipping.rush')}
                    </label>
                    <span className="field-hint">{t('ship.rushHint')}</span>
                  </div>

                  {(catalogue?.addOns ?? []).map((a) => (
                    <div key={a.key}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={addOns.includes(a.key)}
                          onChange={() =>
                            setAddOns((prev) => (prev.includes(a.key) ? prev.filter((k) => k !== a.key) : [...prev, a.key]))
                          }
                        />
                        {t('ship.addon.gps_tracker')} — {formatUsd(a.priceMinor)}
                      </label>
                      {addOns.includes(a.key) && problemFor('addOns') ? (
                        <p className="field-error">{problemText(problemFor('addOns')!)}</p>
                      ) : (
                        <span className="field-hint">
                          {t('ship.addonNeedsInsurance', { amount: formatUsd(a.requiresInsuranceMinor) })}
                        </span>
                      )}
                    </div>
                  ))}

                  <Field label={t('ship.notes')} hint={t('ship.notesHint')}>
                    <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
              </details>
            </div>
          )}

          {step === 'review' && (
            <div className="composer-review">
              <DrawerTag
                kicker={shared.on ? t('ship.shared.requestKicker') : t('ship.quote')}
                amount={shared.on ? undefined : amount}
                title={
                  !shared.on && chosen
                    ? `${serviceLabel(t, chosen)} · ${transitLabel(t, chosen.transitDaysMin, chosen.transitDaysMax)}`
                    : undefined
                }
                lines={reviewLines()}
                note={why ?? undefined}
              />
              {international && <DutiesNotice t={t} guidance={guidance} />}
            </div>
          )}
        </div>

        <footer className="composer-bar">
          <div className="composer-bar-figure">
            <span className="composer-bar-amount" dir="ltr">
              {amount}
            </span>
            <span className="composer-bar-note">
              {selectedIds.length > 0 ? cardCountLabel(t, selectedIds.length) : t('ship.why.noCards')}
            </span>
          </div>
          <div className="composer-bar-actions">
            {stepIndex > 0 && (
              <Button variant="ghost" onClick={back}>
                {t('ship.back')}
              </Button>
            )}
            {step === 'review' ? (
              <Button
                variant="primary"
                icon={shared.on ? <IconUsers /> : <IconShipping />}
                loading={busy}
                disabled={busy || blockers.review !== null || (!shared.on && !chosen)}
                onClick={() => void book()}
              >
                {shared.on
                  ? shared.mode === 'open'
                    ? t('ship.shared.sendAndOpen')
                    : t('ship.shared.sendAndJoin')
                  : chosen
                    ? t('ship.bookAndPay', { amount: formatUsd(chosen.totalMinor) })
                    : t('ship.book')}
              </Button>
            ) : (
              <Button variant="primary" icon={<IconChevronRight />} onClick={next}>
                {t('ship.next')}
              </Button>
            )}
          </div>
          {(barReason || bookError) && (
            <p
              className={`${bookError || barReason !== t('ship.quoting') ? 'field-error' : 'field-hint'} composer-bar-reason`}
              role="alert"
            >
              <bdi dir="auto">{bookError ?? barReason}</bdi>
            </p>
          )}
        </footer>
      </section>

      {step !== 'review' && (
        <aside className="composer-slip">
          <DrawerTag
            kicker={t('ship.quote')}
            amount={amount}
            lines={runningLines}
            status={
              selectedIds.length > 0 ? (
                <StatusBadge tone="info">{t('shipping.selectedCount', { count: selectedIds.length })}</StatusBadge>
              ) : undefined
            }
            note={slipNote}
          />
        </aside>
      )}
    </div>
  );

  function reviewLines(): { label: ReactNode; value: ReactNode }[] {
    const lines: { label: ReactNode; value: ReactNode }[] = [
      { label: t('ship.line.cards'), value: String(selectedIds.length) },
      ...selectedItems.map((item) => ({
        label: <span dir="ltr">{item.serialNumber ?? itemName(t, item)}</span>,
        value: valueMinor(item.id) > 0 ? formatUsd(valueMinor(item.id)) : <span className="drawer-tag-quiet">—</span>,
      })),
    ];
    if (address) {
      lines.push({
        label: t('ship.line.to'),
        value: (
          <bdi dir="auto">
            {[
              address.recipient,
              address.line1,
              address.line2,
              address.city,
              address.region,
              countryName(address.country, countries),
            ]
              .filter(Boolean)
              .join(', ')}
          </bdi>
        ),
      });
      if (address.phone) {
        lines.push({ label: t('ship.line.phone'), value: <span dir="ltr">{address.phone}</span> });
      }
    }
    lines.push({
      label: t('ship.line.insured'),
      value: insuredMinor > 0 ? formatUsd(insuredMinor) : t('ship.line.notInsured'),
    });
    if (international) lines.push({ label: t('ship.customsDeclared'), value: formatUsd(declaredMinor) });
    lines.push({ label: t('ship.signature'), value: effectiveSignature ? t('ship.line.needed') : t('ship.line.notNeeded') });
    if (rush) lines.push({ label: t('shipping.rush'), value: yes });
    if (boxSize) lines.push({ label: t('ship.boxSize'), value: boxLabel(t, { key: boxSize }) });
    if (addOns.includes('gps_tracker')) lines.push({ label: t('ship.addon.gps_tracker'), value: yes });
    if (shared.on) {
      lines.push({
        label: t('ship.shared.line'),
        value: shared.mode === 'open' ? t('ship.shared.youOpen') : <span dir="ltr">{shared.code.trim().toUpperCase()}</span>,
      });
      lines.push({ label: t('ship.line.payNow'), value: t('ship.shared.nothingNow') });
      return lines;
    }
    if (chosen) lines.push({ label: t('ship.line.carrier'), value: formatUsd(chosen.totalMinor) });
    if (international) lines.push({ label: t('ship.line.duties'), value: t('ship.line.dutiesRecipient') });
    if (chosen && balanceMinor !== null) {
      const after = balanceMinor - chosen.totalMinor;
      lines.push(
        after >= 0
          ? { label: t('ship.line.walletAfter'), value: formatUsd(after) }
          : {
              label: t('ship.line.walletShort'),
              value: t('ship.line.walletShortValue', {
                amount: formatUsd(-after),
                days: catalogue?.paymentWindowDays ?? 7,
              }),
            },
      );
    }
    return lines;
  }
}

function ServiceChoice({
  t,
  quote,
  quoting,
  quoteError,
  eligible,
  refused,
  chosen,
  onChoose,
}: {
  t: TranslateFn;
  quote: Quote | null;
  quoting: boolean;
  quoteError: string | null;
  eligible: QuotedRate[];
  refused: QuotedRate[];
  chosen: QuotedRate | undefined;
  onChoose: (key: string) => void;
}) {
  if (!quote) {
    return (
      <p className={quoteError ? 'field-error' : 'field-hint'} role={quoteError ? 'alert' : undefined}>
        <bdi dir="auto">{quoteError ?? (quoting ? t('ship.quoting') : t('ship.quoteEmptyText'))}</bdi>
      </p>
    );
  }
  return (
    <fieldset className="service-choice">
      <legend className="field-label">{t('ship.services')}</legend>
      <p className="field-hint">
        {t(quote.itemCount === 1 ? 'ship.quoteSubtitleOne' : 'ship.quoteSubtitle', {
          count: quote.itemCount,
          weight: formatWeight(quote.totalWeightGrams),
          country: quote.destination.country,
        })}{' '}
        {quote.boxSize ? t('ship.pricedInBox', { box: boxLabel(t, { key: quote.boxSize }) }) : t('ship.pricedOnWeight')}
        {quote.weightEstimated && ` ${t('ship.weightEstimated')}`}
      </p>
      {eligible.length === 0 ? (
        <p className="field-error">
          <IconAlert /> {t('ship.noneEligible')}. {t('ship.noneEligibleText')}
        </p>
      ) : (
        <ul className="service-list">
          {eligible.map((r) => (
            <li key={r.serviceKey}>
              <label className={`service-option${chosen?.serviceKey === r.serviceKey ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="composer-service"
                  checked={chosen?.serviceKey === r.serviceKey}
                  onChange={() => onChoose(r.serviceKey)}
                />
                <span className="service-option-text">
                  <span className="service-option-name">
                    {serviceLabel(t, r)}
                    {r.recommended && <StatusBadge tone="gold">{t('ship.recommended')}</StatusBadge>}
                  </span>
                  <span className="hint">{transitLabel(t, r.transitDaysMin, r.transitDaysMax)}</span>
                  <span className="hint" dir="ltr">
                    {breakdown(t, r)}
                  </span>
                  {r.membershipCover && (r.coveredMinor ?? 0) > 0 && (
                    <span className="hint mem-covered">
                      {t('ship.coveredBy', {
                        tier: t(`tier.name.${r.membershipCover.tier}` as MessageKey),
                        amount: formatUsd(r.coveredMinor ?? 0),
                      })}
                    </span>
                  )}
                </span>
                <span className="service-option-price">
                  <RatePrice rate={r} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {refused.length > 0 && (
        <>
          <h3 className="drawer-heading">{t('ship.unavailable')}</h3>
          <ul className="service-list service-list--refused">
            {refused.map((r) => (
              <li key={r.serviceKey} className="service-refused">
                <span className="service-option-name">{serviceLabel(t, r)}</span>
                <span className="service-option-price hint">
                  <RatePrice rate={r} />
                </span>
                <span className="service-refused-reason hint">
                  {r.problems.map((p) => ruleLabel(t, p)).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}

function breakdown(t: TranslateFn, r: QuotedRate): string {
  const parts = [t('ship.part.carrier', { amount: formatUsd(r.costMinor) })];
  if (r.handlingMinor > 0) parts.push(t('ship.part.handling', { amount: formatUsd(r.handlingMinor) }));
  if (r.insurancePremiumMinor > 0) parts.push(t('ship.part.insurance', { amount: formatUsd(r.insurancePremiumMinor) }));
  if (r.addOnsMinor > 0) parts.push(t('ship.part.addOns', { amount: formatUsd(r.addOnsMinor) }));
  return parts.join(' · ');
}

function DutiesNotice({ t, guidance }: { t: TranslateFn; guidance: DestinationGuidance | null }) {
  const general = guidance?.universal.find((line) => /duty/i.test(line)) ?? t('ship.duties.general');
  const spec = guidance?.specific ?? null;
  return (
    <div className="drawer-note drawer-note--archive composer-duties" role="note">
      <IconAlert />
      <div className="stack stack--tight">
        <strong>{spec ? t('ship.duties.titleIn', { country: spec.name }) : t('ship.duties.title')}</strong>
        <span>{general}</span>
        {spec?.notHandled.map((line) => (
          <span key={line} className="hint">
            {line}
          </span>
        ))}
        {spec && (
          <span className="hint">
            {t('customs.authority')}{' '}
            <a href={spec.authority.url} target="_blank" rel="noopener noreferrer">
              {spec.authority.name}
            </a>
          </span>
        )}
      </div>
    </div>
  );
}

function Confirmation({
  done,
  t,
  paymentWindowDays,
  onAgain,
}: {
  done: Done;
  t: TranslateFn;
  paymentWindowDays: number;
  onAgain: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const tracking = `#/shipping-services/tracking?shipment=${encodeURIComponent(done.id)}`;
  const sharedTab = '#/shipping-services/shared';

  let title: string;
  let text: string;
  let amount: string | undefined;
  let tone: 'success' | 'warning' | 'error' = 'success';
  if (done.kind === 'booked') {
    title = t('ship.done.booked', { code: done.code });
    text = `${serviceLabel(t, done.rate)} · ${transitLabel(t, done.rate.transitDaysMin, done.rate.transitDaysMax)}. ${t('ship.done.bookedNext')}`;
    amount = formatUsd(done.costMinor);
  } else if (done.kind === 'held') {
    title = t('ship.done.held', { code: done.code });
    text = t('ship.done.heldText', { amount: formatUsd(done.shortfallMinor), days: paymentWindowDays });
    amount = formatUsd(done.costMinor);
    tone = 'warning';
  } else if (done.kind === 'shared') {
    title = done.opened
      ? t('ship.done.sharedOpened', { code: done.code })
      : t('ship.done.sharedJoined', { code: done.code, group: done.groupCode ?? '' });
    text = done.opened && done.groupCode ? t('ship.done.sharedCode', { group: done.groupCode }) : t('ship.done.sharedText');
  } else {
    title = t('ship.done.unfinished', { code: done.code });
    text = done.shared ? t('ship.done.unfinishedShared', { reason: done.reason }) : t('ship.done.unfinishedText', { reason: done.reason });
    tone = 'error';
  }

  return (
    <section className="panel composer-done" aria-labelledby="composer-done-title">
      <div className="panel-body stack">
        <h2 className="panel-title" id="composer-done-title" tabIndex={-1} ref={heading}>
          {title}
        </h2>
        <DrawerTag
          kicker={t('ship.done.kicker')}
          amount={amount}
          title={<span dir="ltr">{done.code}</span>}
          status={
            <StatusBadge tone={tone}>
              {done.kind === 'booked'
                ? t('ship.done.statusBooked')
                : done.kind === 'held'
                  ? t('ship.done.statusHeld')
                  : done.kind === 'shared'
                    ? t('ship.done.statusShared')
                    : t('ship.done.statusUnfinished')}
            </StatusBadge>
          }
          note={text}
        />
        <div className="row">
          <ButtonLink variant="primary" href={done.kind === 'shared' ? sharedTab : tracking}>
            {done.kind === 'shared' ? t('ship.done.openShared') : t('ship.done.track')}
          </ButtonLink>
          <Button variant="secondary" onClick={onAgain}>
            {t('ship.done.again')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function refusedForRegion(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'address_region_required';
}

function RatePrice({ rate }: { rate: QuotedRate }) {
  return (
    <TierPrice
      listMinor={rate.listTotalMinor ?? rate.totalMinor}
      chargedMinor={rate.totalMinor}
      tier={rate.tier ?? 'bronze'}
    />
  );
}
