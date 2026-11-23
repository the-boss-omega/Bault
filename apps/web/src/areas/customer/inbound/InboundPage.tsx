import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { formatDate, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { navigate, useNavigation, useRoute } from '../../../shared/routing';
import {
  PARCEL_TONE,
  addressLines,
  estimatedTaxMinor,
  parcelConditionLabel,
  parcelStatusLabel,
  taxRateLabel,
  type InboundAddress,
  type ParcelSummary,
  type ParcelWorkflow,
} from '../../../shared/parcels';
import {
  Button,
  ContextTabs,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { Barcode } from '../../../shared/Barcode';
import { CountUp } from '../../../shared/ui/CountUp';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import { IconCheck, IconInbox, IconLocation, IconPlus, IconSearch, IconVault } from '../../../shared/ui/icons';

const TABS = ['addresses', 'parcels', 'processing'] as const;
type InboundTab = (typeof TABS)[number];

export function InboundPage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord } = useNavigation(route);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parcelsError, setParcelsError] = useState<string | null>(null);
  const [parcels, setParcels] = useState<ParcelSummary[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  const tab: InboundTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as InboundTab)
    : 'addresses';

  const loadParcels = useCallback(async () => {
    try {
      setParcels(await api.get<ParcelSummary[]>('/me/parcels'));
      setParcelsError(null);
    } catch (e) {
      setParcelsError((e as Error).message);
      setParcels((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void loadParcels();
  }, [loadParcels]);

  const tabs = TABS.map((key) => ({ key, label: t(`inbound.tab.${key}` as MessageKey) }));

  const retry = () => {
    setError(null);
    setParcelsError(null);
    setAttempt((n) => n + 1);
    void loadParcels();
  };

  return (
    <>
      <ContextTabs
        label={t('inbound.title')}
        tabs={tabs}
        active={tab}
        onSelect={(next) => {
          setStatus(null);
          goTab(next);
        }}
      />

      {status && <SuccessNote>{status}</SuccessNote>}
      {(error ?? parcelsError) && (
        <ErrorState message={error ?? parcelsError ?? ''} onRetry={retry} retryLabel={t('ui.retry')} />
      )}

      {tab === 'addresses' && (
        <TabPanel tab="addresses">
          <AddressesTab key={attempt} onError={setError} />
        </TabPanel>
      )}

      {tab === 'parcels' && (
        <TabPanel tab="parcels">
          <ParcelsTab
            parcels={parcels}
            openId={route.params.parcel ?? null}
            onOpen={(id) => openRecord('parcel', id)}
            onClose={() => closeRecord('parcel')}
            onChanged={async (message) => {
              setStatus(message);
              await loadParcels();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'processing' && (
        <TabPanel tab="processing">
          <ProcessingTab key={attempt} onError={setError} />
        </TabPanel>
      )}
    </>
  );
}

const EXAMPLE_PURCHASE_MINOR = 50_000;

function AddressesTab({ onError }: { onError: (m: string) => void }) {
  const { t } = useI18n();
  const [addresses, setAddresses] = useState<InboundAddress[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setAddresses(await api.get<InboundAddress[]>('/me/inbound-addresses'));
      } catch (e) {
        onError((e as Error).message);
        setAddresses([]);
      }
    })();
  }, [onError]);

  async function copy(address: InboundAddress) {
    const text = addressLines(address).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(address.code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      onError(t('inbound.address.copyFailed'));
    }
  }

  if (addresses === null) return <SkeletonTable rows={2} columns={2} />;
  if (addresses.length === 0) {
    return (
      <Panel title={t('inbound.address.title')} flush>
        <EmptyState
          title={t('inbound.address.none')}
          text={t('inbound.address.noneText')}
          icon={<IconLocation />}
        />
      </Panel>
    );
  }

  const primary = addresses.find((a) => a.role === 'primary');
  const forwarding = addresses.find((a) => a.role === 'forwarding');
  const taxSaved =
    primary && forwarding
      ? estimatedTaxMinor(EXAMPLE_PURCHASE_MINOR, primary.salesTaxBps) -
        estimatedTaxMinor(EXAMPLE_PURCHASE_MINOR, forwarding.salesTaxBps)
      : 0;

  return (
    <>
      <Panel title={t('inbound.address.title')} subtitle={t('inbound.address.subtitle')}>
        <ul className="card-grid">
          {addresses.map((address) => (
            <li key={address.code} className="card">
              <div className="card-meta">
                <h3 className="card-title" style={{ flex: '1 1 auto' }}>
                  {address.name}
                </h3>
                <StatusBadge tone={address.role === 'primary' ? 'gold' : 'info'}>
                  {t(
                    address.role === 'primary'
                      ? 'inbound.address.rolePrimary'
                      : 'inbound.address.roleForwarding',
                  )}
                </StatusBadge>
              </div>

              <pre className="address-block" dir="ltr">
                {addressLines(address).join('\n')}
              </pre>

              <dl className="detail-list">
                <DetailRow label={t('inbound.address.salesTax')}>
                  {address.salesTaxBps === 0 ? (
                    <StatusBadge tone="success">{t('inbound.address.noSalesTax')}</StatusBadge>
                  ) : (
                    <span dir="ltr">{taxRateLabel(address.salesTaxBps)}</span>
                  )}
                </DetailRow>
                {address.role === 'forwarding' && address.forwardingDays != null && (
                  <DetailRow label={t('inbound.address.transit')}>
                    {t('inbound.address.transitDays', { days: address.forwardingDays })}
                  </DetailRow>
                )}
              </dl>

              <div className="actions">
                <Button
                  size="sm"
                  variant={copied === address.code ? 'secondary' : 'primary'}
                  icon={copied === address.code ? <IconCheck /> : undefined}
                  onClick={() => void copy(address)}
                >
                  {t(copied === address.code ? 'inbound.address.copied' : 'inbound.address.copy')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {primary && forwarding && (
        <Panel title={t('inbound.guidance.title')} subtitle={t('inbound.guidance.subtitle')}>
          <div className="stack stack--tight">
            <p>
              {t('inbound.guidance.body', {
                primary: primary.name,
                primaryRate: taxRateLabel(primary.salesTaxBps),
                forwarding: forwarding.name,
                days: forwarding.forwardingDays ?? 0,
              })}
            </p>
            <p className="field-hint">
              {t('inbound.guidance.example', {
                amount: formatUsd(EXAMPLE_PURCHASE_MINOR),
                saved: formatUsd(taxSaved),
              })}
            </p>
            <p className="field-hint">{t('inbound.guidance.caveat')}</p>
          </div>
        </Panel>
      )}
    </>
  );
}

/** The stops of a parcel's journey, in order; unclaimed and disposed are not on it. */
const PARCEL_STOPS = ['expected', 'received', 'opened', 'processed'] as const;

function ParcelsTab({
  parcels,
  openId,
  onOpen,
  onClose,
  onChanged,
  onError,
}: {
  parcels: ParcelSummary[] | null;
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [registering, setRegistering] = useState(false);
  const selected = useMemo(
    () => (parcels ?? []).find((p) => p.id === openId) ?? null,
    [parcels, openId],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...(parcels ?? [])].sort((a, b) => lastStamp(b) - lastStamp(a));
    if (!needle) return list;
    return list.filter((p) =>
      [p.code, p.trackingNumber, p.carrier, p.declaredContents, p.facilityName, parcelStatusLabel(t, p.status)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [parcels, q, t]);
  const hasParcels = (parcels ?? []).length > 0;
  const formOpen = registering || (parcels !== null && !hasParcels);

  return (
    <>
      {formOpen ? (
        <RegisterParcelForm
          onRegistered={async (message) => {
            setRegistering(false);
            await onChanged(message);
          }}
          onError={onError}
          onCancel={hasParcels ? () => setRegistering(false) : undefined}
        />
      ) : (
        parcels !== null && (
          <div className="row">
            <Button variant="primary" icon={<IconPlus />} onClick={() => setRegistering(true)}>
              {t('inbound.register.title')}
            </Button>
            <span className="field-hint">{t('inbound.register.optional')}</span>
          </div>
        )
      )}

      <Panel title={t('inbound.parcels.title')} subtitle={t('inbound.parcels.subtitle')} flush>
        {hasParcels && (
          <div className="vault-command">
            <div className="vault-search">
              <IconSearch />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('inbound.parcels.searchPlaceholder')}
                aria-label={t('inbound.parcels.search')}
              />
            </div>
          </div>
        )}
        {parcels === null ? (
          <SkeletonTable rows={4} columns={5} />
        ) : parcels.length === 0 ? (
          <EmptyState
            title={t('inbound.parcels.empty')}
            text={t('inbound.parcels.emptyText')}
            icon={<IconInbox />}
            action={
              <Button size="sm" onClick={() => navigate({ section: 'inbound', tab: 'addresses' })}>
                {t('inbound.parcels.seeAddresses')}
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={t('inbound.parcels.noMatch')}
            text={t('inbound.parcels.noMatchText')}
            icon={<IconSearch />}
            action={
              <Button size="sm" onClick={() => setQ('')}>
                {t('vault.clearSearch')}
              </Button>
            }
          />
        ) : (
          <ul className="labels" aria-label={t('inbound.parcels.title')}>
            {shown.map((p) => {
              const stamps: Record<(typeof PARCEL_STOPS)[number], string | null> = {
                expected: p.expectedAt,
                received: p.receivedAt,
                opened: p.openedAt,
                processed: p.processedAt,
              };
              const onTrack = (PARCEL_STOPS as readonly string[]).includes(p.status);
              return (
                <li
                  key={p.id}
                  className={'label-card' + (p.id === openId ? ' is-selected' : '')}
                  onClick={() => onOpen(p.id)}
                >
                  <div className="label-main">
                    <div className="label-head">
                      <span className="label-code" dir="ltr">
                        {p.code}
                      </span>
                      <StatusBadge tone={PARCEL_TONE[p.status] ?? 'neutral'}>
                        {parcelStatusLabel(t, p.status)}
                      </StatusBadge>
                    </div>

                    <p className="label-what">{p.declaredContents || t('inbound.parcels.undeclared')}</p>

                    <p className="label-meta">
                      <span>{p.facilityName ?? '—'}</span>
                      {p.forwardedAt && <span>{t('inbound.parcels.forwarded')}</span>}
                      <span>
                        {t('inbound.parcels.col.updated')}{' '}
                        {formatDate(
                          p.processedAt ?? p.openedAt ?? p.receivedAt ?? p.expectedAt ?? '',
                          locale,
                        ) || '—'}
                      </span>
                    </p>

                    {onTrack && (
                      <ol className="label-track" aria-label={t('inbound.parcels.col.status')}>
                        {PARCEL_STOPS.map((stop) => (
                          <li
                            key={stop}
                            data-reached={stamps[stop] ? 'true' : 'false'}
                            aria-current={p.status === stop ? 'step' : undefined}
                          >
                            <span className="label-stop">{parcelStatusLabel(t, stop)}</span>
                            <span className="label-when">
                              {stamps[stop] ? formatDate(stamps[stop] ?? '', locale) : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}

                    <div className="label-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(p.id);
                        }}
                      >
                        {t('inbound.parcels.details')}
                      </Button>
                    </div>
                  </div>

                  <div className="label-stub">
                    <span className="label-bars" aria-hidden="true" />
                    <span className="label-tracking" dir="ltr">
                      {p.trackingNumber ? <code>{p.trackingNumber}</code> : <span className="muted">—</span>}
                    </span>
                    {p.carrier && <span className="label-carrier">{p.carrier}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {selected && (
        <ParcelDrawer
          parcel={selected}
          t={t}
          locale={locale}
          onClose={onClose}
          onChanged={onChanged}
          onError={onError}
        />
      )}
    </>
  );
}

function lastStamp(p: ParcelSummary): number {
  const at = p.processedAt ?? p.openedAt ?? p.receivedAt ?? p.expectedAt;
  return at ? new Date(at).getTime() : 0;
}

export function RegisterParcelForm({
  onRegistered,
  onError,
  onCancel,
}: {
  onRegistered: (message: string) => Promise<void>;
  onError: (m: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [addresses, setAddresses] = useState<InboundAddress[]>([]);
  const [facilityCode, setFacilityCode] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [declaredContents, setDeclaredContents] = useState('');
  const [internationalOrigin, setInternationalOrigin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        setAddresses(list);
        const preferred = list.find((a) => a.role === 'primary') ?? list[0];
        if (preferred) setFacilityCode(preferred.code);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    setTrackingError(null);
    try {
      const created = await api.post<{ code: string }>('/me/parcels', {
        facilityCode,
        carrier: carrier.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        declaredContents: declaredContents.trim() || undefined,
        internationalOrigin,
      });
      setCarrier('');
      setTrackingNumber('');
      setDeclaredContents('');
      setInternationalOrigin(false);
      await onRegistered(t('inbound.register.done', { code: created.code }));
    } catch (e) {
      const failure = e as Error & { status?: number };
      if (failure.status === 409) setTrackingError(failure.message);
      else setSubmitError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const facility = addresses.find((a) => a.code === facilityCode);
  const tracking = trackingNumber.trim();
  const contents = declaredContents.trim();

  return (
    <Panel title={t('inbound.register.title')} subtitle={t('inbound.register.subtitle')}>
      <div className="request-form">
        <div className="stack stack--tight request-form-fields">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t('inbound.register.facility')}</span>
              <select value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)}>
                {addresses.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('inbound.register.carrier')}</span>
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} dir="auto" maxLength={60} />
            </label>
            <Field
              label={t('inbound.register.tracking')}
              hint={t('inbound.register.trackingHint')}
              error={trackingError ?? undefined}
            >
              <input
                value={trackingNumber}
                onChange={(e) => {
                  setTrackingNumber(e.target.value);
                  setTrackingError(null);
                }}
                dir="ltr"
                maxLength={120}
                aria-invalid={trackingError ? true : undefined}
              />
            </Field>
            <label className="field">
              <span className="field-label">{t('inbound.register.contents')}</span>
              <input
                value={declaredContents}
                onChange={(e) => setDeclaredContents(e.target.value)}
                dir="auto"
                maxLength={500}
              />
            </label>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={internationalOrigin}
              onChange={(e) => setInternationalOrigin(e.target.checked)}
            />
            {t('inbound.register.international')}
          </label>
          {internationalOrigin && (
            <p className="field-hint">{t('inbound.register.internationalHint')}</p>
          )}
          {submitError && <ErrorState message={submitError} />}
        </div>

        <aside className="request-slip">
          <DrawerTag
            kicker={t('inbound.register.title')}
            title={contents || <span className="drawer-tag-quiet">{t('inbound.parcels.undeclared')}</span>}
            status={<StatusBadge tone={PARCEL_TONE.expected ?? 'neutral'}>{parcelStatusLabel(t, 'expected')}</StatusBadge>}
            lines={[
              { label: t('inbound.register.facility'), value: facility?.name ?? '—' },
              ...(carrier.trim() ? [{ label: t('inbound.register.carrier'), value: carrier.trim() }] : []),
              ...(internationalOrigin ? [{ label: t('inbound.register.international'), value: '✓' }] : []),
            ]}
          >
            <div className="parcel-stub">
              {tracking ? (
                <Barcode value={tracking} options={{ moduleWidth: 1, height: 44 }} />
              ) : (
                <span className="parcel-stub-empty">{t('inbound.parcels.col.tracking')} —</span>
              )}
            </div>
          </DrawerTag>
        </aside>

        <div className="row request-form-actions">
          <Button
            variant="primary"
            icon={<IconPlus />}
            disabled={busy || !facilityCode}
            onClick={() => void submit()}
          >
            {t('inbound.register.submit')}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t('ui.cancel')}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ParcelDrawer({
  parcel,
  t,
  locale,
  onClose,
  onChanged,
  onError,
}: {
  parcel: ParcelSummary;
  t: TranslateFn;
  locale: string;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await api.post(`/me/parcels/${parcel.id}/cancel`);
      await onChanged(t('inbound.parcel.cancelled', { code: parcel.code }));
      onClose();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
    <DetailDrawer
      title={parcel.code}
      subtitle={parcelStatusLabel(t, parcel.status)}
      onClose={onClose}
      footer={
        <>
          {parcel.status === 'expected' && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
              {t('inbound.parcel.cancel')}
            </Button>
          )}
          {parcel.status === 'processed' && (
            <Button variant="primary" icon={<IconVault />} onClick={() => navigate({ section: 'vault', tab: 'active' })}>
              {t('inbound.parcel.toVault')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      <dl className="detail-list">
        <DetailRow label={t('inbound.parcels.col.status')}>
          <StatusBadge tone={PARCEL_TONE[parcel.status] ?? 'neutral'}>
            {parcelStatusLabel(t, parcel.status)}
          </StatusBadge>
        </DetailRow>
        <DetailRow label={t('inbound.parcels.col.where')}>{parcel.facilityName ?? '—'}</DetailRow>
        <DetailRow label={t('inbound.register.contents')}>
          {parcel.declaredContents || t('inbound.parcels.undeclared')}
        </DetailRow>
        <DetailRow label={t('inbound.parcels.col.tracking')}>
          {parcel.trackingNumber ? <code dir="ltr">{parcel.trackingNumber}</code> : '—'}
        </DetailRow>
        <DetailRow label={t('inbound.register.carrier')}>{parcel.carrier ?? '—'}</DetailRow>
        {parcel.internationalOrigin && (
          <DetailRow label={t('inbound.parcel.origin')}>
            <StatusBadge tone="warning">{t('inbound.parcel.international')}</StatusBadge>
          </DetailRow>
        )}
        {parcel.receivedAt && (
          <DetailRow label={t('inbound.parcel.receivedAt')}>
            <span className="date">{formatDate(parcel.receivedAt, locale)}</span>
          </DetailRow>
        )}
        {parcel.forwardedAt && (
          <DetailRow label={t('inbound.parcel.forwardedAt')}>
            <span className="date">{formatDate(parcel.forwardedAt, locale)}</span>
          </DetailRow>
        )}
        {parcel.openedAt && (
          <DetailRow label={t('inbound.parcel.openedAt')}>
            <span className="date">{formatDate(parcel.openedAt, locale)}</span>
          </DetailRow>
        )}
        {parcel.processedAt && (
          <DetailRow label={t('inbound.parcel.processedAt')}>
            <span className="date">{formatDate(parcel.processedAt, locale)}</span>
          </DetailRow>
        )}
        {parcel.condition && (
          <DetailRow label={t('inbound.parcel.condition')}>
            <StatusBadge tone={parcel.condition === 'sound' ? 'success' : 'error'}>
              {parcelConditionLabel(t, parcel.condition)}
            </StatusBadge>
            {parcel.conditionNotes && <span className="detail-value-sub">{parcel.conditionNotes}</span>}
          </DetailRow>
        )}
      </dl>
      <p className="field-hint">{t(`inbound.parcel.next.${parcel.status}` as MessageKey)}</p>
    </DetailDrawer>
    {confirming && (
      <ConfirmationModal
        title={t('inbound.parcel.cancelTitle')}
        body={<p>{t('inbound.parcel.cancelBody', { code: parcel.code })}</p>}
        confirmLabel={t('inbound.parcel.cancel')}
        cancelLabel={t('inbound.parcel.keep')}
        tone="danger"
        busy={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setConfirming(false)}
      />
    )}
    </>
  );
}

function ProcessingTab({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [workflow, setWorkflow] = useState<ParcelWorkflow | null>(null);

  const load = useCallback(async () => {
    try {
      setWorkflow(await api.get<ParcelWorkflow>('/parcels/workflow/status'));
    } catch (e) {
      onError(t('inbound.workflow.failed', { reason: (e as Error).message }));
    }
  }, [onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stations = [
    {
      key: 'open',
      label: t('inbound.workflow.awaitingOpen'),
      note: t('inbound.workflow.awaitingOpenNote'),
      count: workflow?.awaitingOpen,
    },
    {
      key: 'processing',
      label: t('inbound.workflow.awaitingProcessing'),
      note: t('inbound.workflow.awaitingProcessingNote'),
      count: workflow?.awaitingProcessing,
    },
  ];

  return (
    <>
      <section className="queue-board">
        <ol className="queue" aria-label={t('inbound.tab.processing')}>
          {stations.map((station) => (
            <li className="queue-stop" key={station.key} data-waiting={station.count ? 'true' : 'false'}>
              <p className="slip-label">{station.label}</p>
              <p className="queue-figure">
                {workflow ? <CountUp value={String(station.count ?? 0)} /> : '—'}
              </p>
              <p className="queue-note">{station.note}</p>
            </li>
          ))}
        </ol>

        <p className="queue-oldest">
          <span className="slip-label">{t('inbound.workflow.oldest')}</span>
          <span className="queue-hours">
            {workflow?.oldestWaitingHours == null
              ? '—'
              : t('inbound.workflow.hours', { hours: workflow.oldestWaitingHours })}
          </span>
          <span className="queue-note">
            {workflow?.oldestReceivedAt
              ? t('inbound.workflow.since', { date: formatDate(workflow.oldestReceivedAt, locale) })
              : t('inbound.workflow.oldestNote')}
          </span>
        </p>
      </section>

      <Panel title={t('inbound.workflow.title')} subtitle={t('inbound.workflow.subtitle')}>
        <p className="field-hint">{t('inbound.workflow.explainer')}</p>
      </Panel>
    </>
  );
}
