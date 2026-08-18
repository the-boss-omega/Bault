import { useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { formatDate } from '../../../shared/money';
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
}

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
}: {
  items: CullItem[];
  windowDays: number;
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
        const reason = it.holdFlag
          ? t('cull.blocked.hold')
          : it.lifecycleState !== 'stored'
            ? t('cull.blocked.state')
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
                    {it.description || it.typeClass}
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
              {t('cull.submit', { count: chosen.length })}
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
