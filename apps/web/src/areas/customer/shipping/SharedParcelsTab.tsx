import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { formatWeight } from '../../../shared/carriers';
import { shipmentStatusLabel, type ShipmentSummary } from '../../../shared/shipments';
import { Button, EmptyState, Field, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconAlert, IconUsers } from '../../../shared/ui/icons';

interface GroupMember {
  shipmentId: string;
  shipmentCode: string | null;
  username: string | null;
  name: string | null;
  itemCount: number;
  weightGrams: number;
  isPayer: boolean;
  insuredValueMinor: number;
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

/**
 * Shipping together — several collectors, one parcel, one payer.
 *
 * Three people at a convention with cards in the vault and one hotel address
 * between them. The obvious implementation would have been one shipment
 * carrying everybody's cards, and it is the wrong one: an item has exactly one
 * owner, and a shipment that moves somebody else's card is a custody event they
 * never authorised.
 *
 * So what this screen shows is a group of SHIPMENTS, not a shipment of several
 * people's items. Each collector keeps their own request; the group says they
 * travel together and who is paying the carrier. Nobody is ever added to one —
 * you join with a request of your own, to the same address, or you are not in it.
 */
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
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  /** Every shipment of mine, so a group row knows which member is me. */
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
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
      // Only an unrated request can open or join a group — once a service is
      // chosen the parcel has been paid for and is on its way to a bench.
      setShipments(all.filter((s) => s.status === 'requested' && !s.groupId));
      setMineIds(new Set(all.map((s) => s.id)));
    } catch (e) {
      onError((e as Error).message);
      setGroups([]);
    }
  }, [onError]);

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
    }
  }

  return (
    <>
      <Panel title={t('grp.start')} subtitle={t('grp.startSubtitle')}>
        {shipments.length === 0 ? (
          <EmptyState title={t('grp.noRequests')} text={t('grp.noRequestsText')} icon={<IconUsers />} />
        ) : (
          <div className="stack stack--tight" style={{ maxWidth: 620 }}>
            <label className="field">
              <span className="field-label">{t('grp.whichRequest')}</span>
              <select value={openShipmentId} onChange={(e) => setOpenShipmentId(e.target.value)}>
                <option value="">{t('grp.pickRequest')}</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.destinationAddress}
                  </option>
                ))}
              </select>
            </label>
            <Field label={t('grp.notes')} hint={t('grp.notesHint')}>
              <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="row">
              <Button
                variant="gold"
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
              <span className="field-hint">{t('grp.payerNote')}</span>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t('grp.join')} subtitle={t('grp.joinSubtitle')}>
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
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
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.destinationAddress}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Button
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

      <Panel title={t('grp.mine')} subtitle={t('grp.mineSubtitle')}>
        {groups === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : groups.length === 0 ? (
          <EmptyState title={t('grp.none')} text={t('grp.noneText')} icon={<IconUsers />} />
        ) : (
          groups.map((g) => {
            const payer = g.members.find((m) => m.isPayer);
            return (
              <div key={g.id} className="stack stack--tight" style={{ marginBlockEnd: 'var(--sp-5)' }}>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  <code dir="ltr">{g.code}</code>
                  <StatusBadge tone={g.status === 'forming' ? 'warning' : g.status === 'locked' ? 'info' : 'neutral'}>
                    {t(`grp.status.${g.status}` as never)}
                  </StatusBadge>
                  <span className="hint">
                    {t('grp.summary', {
                      members: g.memberCount,
                      items: g.totalItems,
                      weight: formatWeight(g.totalWeightGrams),
                    })}
                  </span>
                </div>
                <p className="hint">{g.destinationAddress}</p>
                {g.notes && <p className="hint">{g.notes}</p>}

                <ul className="check-list list-unbounded">
                  {g.members.map((m) => (
                    <li key={m.shipmentId}>
                      <span>
                        {m.name ?? m.username ?? '—'}
                        <span className="hint" dir="ltr">
                          {' '}
                          {m.shipmentCode} · {m.itemCount} · {formatWeight(m.weightGrams)}
                          {m.insuredValueMinor > 0 ? ` · ${formatUsd(m.insuredValueMinor)}` : ''}
                        </span>
                      </span>
                      <span className="row" style={{ gap: 'var(--sp-2)' }}>
                        {m.isPayer && <StatusBadge tone="gold">{t('grp.payer')}</StatusBadge>}
                        <StatusBadge tone="neutral" plain>
                          {shipmentStatusLabel(t, m.status)}
                        </StatusBadge>
                        {/* Your own request can leave a group that is still forming.
                            The payer cannot — cancelling the group is theirs. */}
                        {g.status === 'forming' && !m.isPayer && mineIds.has(m.shipmentId) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                () => api.post('/shipping/groups/leave', { shipmentId: m.shipmentId }),
                                t('grp.left', { code: g.code }),
                              )
                            }
                          >
                            {t('grp.leave')}
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {g.status === 'forming' && (
                  <div className="row">
                    <Button
                      size="sm"
                      variant="gold"
                      disabled={busy || g.memberCount < 2}
                      onClick={() => void act(() => api.post(`/shipping/groups/${g.id}/lock`), t('grp.locked'))}
                    >
                      {t('grp.lock')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<IconAlert />}
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
                      {t('grp.cancel')}
                    </Button>
                    {g.memberCount < 2 && <span className="field-hint">{t('grp.needTwo')}</span>}
                    {payer && <span className="field-hint">{t('grp.onlyPayer')}</span>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}
