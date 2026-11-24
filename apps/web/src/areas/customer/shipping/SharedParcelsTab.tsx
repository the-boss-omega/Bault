import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { formatWeight } from '../../../shared/carriers';
import { shipmentStatusLabel, type ShipmentSummary } from '../../../shared/shipments';
import { Button, EmptyState, ErrorState, Field, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { navigate } from '../../../shared/routing';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { IconAlert, IconUsers } from '../../../shared/ui/icons';

interface GroupMember {
  shipmentId: string;
  shipmentCode: string | null;
  username: string | null;
  itemCount: number;
  weightGrams?: number;
  isPayer: boolean;
  insuredValueMinor?: number;
  status: string;
}

interface Group {
  id: string;
  code: string;
  status: string;
  destinationAddress: string;
  recipientName: string;
  notes: string | null;
  memberCount: number;
  totalItems: number;
  totalWeightGrams: number;
  members: GroupMember[];
}

export function SharedParcelsTab({
  reloadToken,
  onChanged,
  onError,
  onStatus,
}: {
  reloadToken: number;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
}) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [shipments, setShipments] = useState<ShipmentSummary[] | null>(null);
  const [mineIds, setMineIds] = useState<ReadonlySet<string>>(new Set());
  const [openShipmentId, setOpenShipmentId] = useState('');
  const [joinShipmentId, setJoinShipmentId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, all] = await Promise.all([
        api.get<Group[]>('/shipping/groups'),
        api.get<ShipmentSummary[]>('/shipping/shipments'),
      ]);
      setGroups(mine);
      setShipments(all.filter((s) => s.status === 'requested' && !s.groupId));
      setMineIds(new Set(all.map((s) => s.id)));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

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
      setConfirmCancel(null);
    }
  }

  const quiet = <span className="drawer-tag-quiet">—</span>;
  const free = shipments ?? [];
  const opening = free.find((x) => x.id === openShipmentId);
  const joining = free.find((x) => x.id === joinShipmentId);

  if (loadError && groups === null) {
    return (
      <Panel title={t('grp.mine')} subtitle={t('grp.mineSubtitle')}>
        <ErrorState
          title={t('grp.loadFailed')}
          message={loadError}
          onRetry={() => void load()}
          retryLabel={t('ui.retry')}
        />
      </Panel>
    );
  }

  return (
    <>
      <Panel title={t('grp.mine')} subtitle={t('grp.mineSubtitle')}>
        {loadError && (
          <ErrorState
            title={t('grp.loadFailed')}
            message={loadError}
            onRetry={() => void load()}
            retryLabel={t('ui.retry')}
          />
        )}
        {groups === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : groups.length === 0 ? (
          <EmptyState title={t('grp.none')} text={t('grp.noneText')} icon={<IconUsers />} />
        ) : (
          <ul className="tag-grid">
            {groups.map((g) => {
              const iPay = g.members.some((m) => m.isPayer && mineIds.has(m.shipmentId));
              return (
                <li key={g.id} className="tag-item tag-item--group">
                  <DrawerTag
                    item
                    kicker={g.code}
                    title={<bdi dir="auto">{g.recipientName}</bdi>}
                    status={
                      <StatusBadge
                        tone={
                          g.status === 'forming'
                            ? 'warning'
                            : g.status === 'locked'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {t(`grp.status.${g.status}` as never)}
                      </StatusBadge>
                    }
                    note={t('grp.summary', {
                      members: g.memberCount,
                      items: g.totalItems,
                      weight: formatWeight(g.totalWeightGrams),
                    })}
                  >
                    <dl className="ledger-lines drawer-tag-lines">
                      <div className="ledger-line">
                        <dt>{t('grp.slip.goesTo')}</dt>
                        <dd>
                          <bdi dir="auto">{g.destinationAddress}</bdi>
                        </dd>
                      </div>
                      {g.notes && (
                        <div className="ledger-line">
                          <dt>{t('grp.notes')}</dt>
                          <dd>
                            <bdi dir="auto">{g.notes}</bdi>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <ul className="group-members">
                      {g.members.map((m) => {
                        const mine = mineIds.has(m.shipmentId);
                        return (
                          <li key={m.shipmentId} className="group-member">
                            <span className="group-member-name">
                              <bdi dir="auto">{m.username ?? '—'}</bdi>
                              {m.isPayer && <StatusBadge tone="gold">{t('grp.payer')}</StatusBadge>}
                            </span>
                            <span className="group-member-state">
                              {shipmentStatusLabel(t, m.status)}
                            </span>
                            <span className="group-member-meta" dir="ltr">
                              {mine ? (
                                <>
                                  {m.shipmentCode} · {m.itemCount === 1 ? t('grp.memberItemsOne') : t('grp.memberItems', { count: m.itemCount })}
                                  {m.weightGrams !== undefined ? ` · ${formatWeight(m.weightGrams)}` : ''}
                                  {m.insuredValueMinor ? ` · ${formatUsd(m.insuredValueMinor)}` : ''}
                                </>
                              ) : (
                                m.itemCount === 1 ? t('grp.memberItemsOne') : t('grp.memberItems', { count: m.itemCount })
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </DrawerTag>

                  {g.status === 'forming' && !iPay && (
                    <p className="field-hint tag-actions">{t('grp.onlyPayer')}</p>
                  )}
                  {g.status === 'forming' && iPay && (
                    <div className="row tag-actions">
                      {confirmCancel === g.id ? (
                        <>
                          <span className="field-hint" role="alert">
                            {t('grp.cancelConfirm')}
                          </span>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () =>
                                  api.post(`/shipping/groups/${g.id}/cancel`, {
                                    reason: t('grp.cancelledByPayer'),
                                  }),
                                t('grp.cancelled'),
                              )
                            }
                          >
                            {t('grp.cancelYes')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(null)}>
                            {t('grp.keep')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy || g.memberCount < 2}
                            onClick={() =>
                              void act(() => api.post(`/shipping/groups/${g.id}/lock`), t('grp.locked'))
                            }
                          >
                            {t('grp.lock')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<IconAlert />}
                            disabled={busy}
                            onClick={() => setConfirmCancel(g.id)}
                          >
                            {t('grp.cancel')}
                          </Button>
                          {g.memberCount < 2 && <span className="field-hint">{t('grp.needTwo')}</span>}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t('grp.start')} subtitle={t('grp.startSubtitle')}>
        {shipments === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : free.length === 0 ? (
          <EmptyState
            title={t('grp.noRequests')}
            text={t('grp.noRequestsText')}
            icon={<IconUsers />}
            action={
              <Button variant="primary" onClick={() => navigate({ section: 'shipping-services', tab: 'shipping' })}>
                {t('grp.goShipping')}
              </Button>
            }
          />
        ) : (
          <div className="request-form">
            <div className="stack stack--tight request-form-fields">
              <label className="field">
                <span className="field-label">{t('grp.whichRequest')}</span>
                <select value={openShipmentId} onChange={(e) => setOpenShipmentId(e.target.value)}>
                  <option value="">{t('grp.pickRequest')}</option>
                  {free.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.destinationAddress}
                    </option>
                  ))}
                </select>
              </label>
              <Field label={t('grp.notes')} hint={t('grp.notesHint')}>
                <input
                  value={notes}
                  maxLength={500}
                  dir="auto"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>

            <aside className="request-slip">
              <DrawerTag
                kicker={t('grp.start')}
                title={
                  opening ? (
                    <bdi dir="auto">{opening.destinationAddress}</bdi>
                  ) : (
                    <span className="drawer-tag-quiet">{t('grp.slip.goesTo')}</span>
                  )
                }
                lines={[
                  {
                    label: t('grp.whichRequest'),
                    value: opening ? <bdi dir="ltr">{opening.code}</bdi> : quiet,
                  },
                  {
                    label: t('grp.notes'),
                    value: notes.trim() ? <bdi dir="auto">{notes.trim()}</bdi> : quiet,
                  },
                  { label: t('grp.payer'), value: t('grp.slip.you') },
                ]}
                status={<StatusBadge tone="warning">{t('grp.status.forming')}</StatusBadge>}
                note={t('grp.payerNote')}
              />
            </aside>

            <div className="row request-form-actions">
              <Button
                variant="primary"
                icon={<IconUsers />}
                disabled={busy || !openShipmentId}
                onClick={() =>
                  void act(
                    () =>
                      api.post('/shipping/groups', {
                        shipmentId: openShipmentId,
                        notes: notes.trim() || undefined,
                      }),
                    t('grp.opened'),
                  )
                }
              >
                {t('grp.open')}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {free.length > 0 && (
        <Panel title={t('grp.join')} subtitle={t('grp.joinSubtitle')}>
          <div className="request-form">
            <div className="stack stack--tight request-form-fields">
              <label className="field">
                <span className="field-label">{t('grp.code')}</span>
                <input
                  value={joinCode}
                  dir="ltr"
                  placeholder="GRP-XXXXXXXX"
                  onChange={(e) => setJoinCode(e.target.value)}
                />
              </label>
              <Field label={t('grp.whichRequest')} hint={t('grp.sameAddressHint')}>
                <select value={joinShipmentId} onChange={(e) => setJoinShipmentId(e.target.value)}>
                  <option value="">{t('grp.pickRequest')}</option>
                  {free.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.destinationAddress}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <aside className="request-slip">
              <DrawerTag
                kicker={t('grp.join')}
                title={
                  joinCode.trim() ? (
                    <bdi dir="ltr">{joinCode.trim()}</bdi>
                  ) : (
                    <span className="drawer-tag-quiet" dir="ltr">
                      GRP-XXXXXXXX
                    </span>
                  )
                }
                lines={[
                  {
                    label: t('grp.whichRequest'),
                    value: joining ? <bdi dir="ltr">{joining.code}</bdi> : quiet,
                  },
                  {
                    label: t('grp.slip.goesTo'),
                    value: joining ? <bdi dir="auto">{joining.destinationAddress}</bdi> : quiet,
                  },
                ]}
                note={t('grp.sameAddressHint')}
              />
            </aside>

            <div className="row request-form-actions">
              <Button
                variant="primary"
                disabled={busy || !joinCode.trim() || !joinShipmentId}
                onClick={() =>
                  void act(
                    () =>
                      api.post('/shipping/groups/join', {
                        groupCode: joinCode.trim(),
                        shipmentId: joinShipmentId,
                      }),
                    t('grp.joined'),
                  )
                }
              >
                {t('grp.joinAction')}
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}
