import { useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import { displayName } from '../../../shared/timeline';
import { itemClassLabel } from '../../../shared/itemClasses';
import { Button, EmptyState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { IconAlert, IconArchive } from '../../../shared/ui/icons';

interface CullItem {
  id: string;
  serialNumber: string;
  typeClass: string;
  description: string;
  lifecycleState: string;
  holdFlag?: boolean;
  receivedAt?: string | null;
  commitment?: { kind: string; code: string | null } | null;
}

/**
 * A card worth at least this much is not a "common", whatever the cull window
 * says. It is still allowed — it is the collector's card — but it is flagged,
 * because a $50 card thrown away with forty $1 ones is a mistake nobody
 * notices until it is gone.
 */
const WORTH_FLAGGING_MINOR = 2_000;

/**
 * The bulk cull — cards worth less than the storage they are about to accrue.
 *
 * A collector who sends in a shoebox gets back a vault containing forty commons
 * they never wanted individually catalogued, and every one of them starts
 * costing storage the day the included period ends. Culling them one at a time
 * through the donation flow is forty confirmations.
 *
 * Two things about this are deliberate. It is FREE, because charging somebody to
 * stop charging them is indefensible. And it is limited to a window after
 * arrival, which is why the ineligible cards are still LISTED here, greyed, with
 * the reason on them — a card that quietly vanished from this list would read as
 * a bug, where "the window closed for this one" reads as the rule it is.
 */
export function RemoveCommonsPanel({
  items,
  windowDays,
  onDone,
  onError,
  values,
}: {
  items: CullItem[];
  windowDays: number;
  /** The Break-Even Watch's value estimate per card, where it has an honest one. */
  values?: ReadonlyMap<string, number | null>;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<'discard' | 'donate'>('donate');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const cutoff = Date.now() - windowDays * 86_400_000;

  /** Eligibility mirrors the server's checks so the reason is visible up front. */
  const rows = useMemo(
    () =>
      items.map((it) => {
        const arrived = it.receivedAt ? new Date(it.receivedAt).getTime() : 0;
        // The reason in the card's own terms: a listed card is "listed", not
        // "not stored", which reads as though Bault had misplaced it.
        const reason = it.holdFlag
          ? t('cull.blocked.hold')
          : it.lifecycleState === 'listed'
            ? t('cull.blocked.listed')
            : it.lifecycleState === 'at_grader'
              ? t('vault.state.atGrader')
              : it.lifecycleState !== 'stored'
                ? t('cull.blocked.state')
                : it.commitment
                  ? t('cull.blocked.committed')
                  : !it.receivedAt || arrived < cutoff
              ? t('cull.blocked.window', { days: windowDays })
              : null;
        return { it, reason };
      }),
    [items, cutoff, windowDays, t],
  );

  const eligible = rows.filter((r) => !r.reason);

  function toggle(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    try {
      const challenge = await api.post<{ confirmationToken: string }>('/services/remove-commons', {
        itemIds: chosen,
        outcome,
      });
      const result = await api.post<{ count: number }>('/services/remove-commons/confirm', {
        confirmationToken: challenge.confirmationToken,
      });
      setChosen([]);
      onDone(t('cull.done', { count: result.count }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Panel title={t('cull.title')} subtitle={t('cull.subtitle', { days: windowDays })}>
      {rows.length === 0 ? (
        <EmptyState title={t('cull.empty')} text={t('cull.emptyText')} icon={<IconArchive />} />
      ) : (
        <>
          <ul className="check-list">
            {rows.map(({ it, reason }) => (
              <li key={it.id}>
                <label className={`check${reason ? ' is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={Boolean(reason)}
                    checked={chosen.includes(it.id)}
                    onChange={() => toggle(it.id)}
                  />
                  <span>
                    {displayName(it.description) || itemClassLabel(t, it.typeClass)}
                    <span className="hint" dir="ltr">
                      {' '}
                      {it.serialNumber}
                      {it.receivedAt ? ` · ${formatDate(it.receivedAt, locale)}` : ''}
                    </span>
                  </span>
                </label>
                {reason && (
                  <StatusBadge tone="neutral" plain>
                    {reason}
                  </StatusBadge>
                )}
                {!reason && (values?.get(it.id) ?? 0) >= WORTH_FLAGGING_MINOR && (
                  <StatusBadge tone="warning">
                    {t('cull.worth', { amount: formatUsd(values?.get(it.id) ?? 0) })}
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>

          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">{t('cull.outcome')}</legend>
            <label className="check">
              <input
                type="radio"
                name="cull-outcome"
                checked={outcome === 'donate'}
                onChange={() => setOutcome('donate')}
              />
              {t('cull.outcome.donate')}
            </label>
            <label className="check">
              <input
                type="radio"
                name="cull-outcome"
                checked={outcome === 'discard'}
                onChange={() => setOutcome('discard')}
              />
              {t('cull.outcome.discard')}
            </label>
          </fieldset>

          <p className="field-hint">{t('cull.freeNote')}</p>

          <div className="row">
            <Button
              variant="danger"
              icon={<IconAlert />}
              disabled={busy || chosen.length === 0}
              onClick={() => setConfirming(true)}
            >
              {chosen.length === 0 ? t('cull.submitNone') : t('cull.submit', { count: chosen.length })}
            </Button>
            {eligible.length === 0 && <span className="field-hint">{t('cull.noneEligible')}</span>}
          </div>
        </>
      )}

      {confirming && (
        <ConfirmationModal
          title={t('cull.confirmTitle')}
          body={
            <p>
              {outcome === 'discard'
                ? t('cull.confirmDiscard', { count: chosen.length })
                : t('cull.confirmDonate', { count: chosen.length })}
            </p>
          }
          confirmLabel={t('cull.confirmAction')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void submit()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}
