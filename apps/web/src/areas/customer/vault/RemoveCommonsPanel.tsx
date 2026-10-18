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

  const selected = useMemo(() => {
    const visible = new Map(eligible.map((r) => [r.it.id, r.it]));
    return chosen.flatMap((id) => {
      const it = visible.get(id);
      return it ? [it] : [];
    });
  }, [chosen, eligible]);

  function toggle(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    try {
      const challenge = await api.post<{ confirmationToken: string }>('/services/remove-commons', {
        itemIds: selected.map((it) => it.id),
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
              disabled={busy || selected.length === 0}
              onClick={() => setConfirming(true)}
            >
              {t('cull.submit', { count: selected.length })}
            </Button>
            {eligible.length === 0 && <span className="field-hint">{t('cull.noneEligible')}</span>}
          </div>
        </>
      )}

      {confirming && (
        <ConfirmationModal
          title={t('cull.confirmTitle')}
          body={
            <>
              <p>
                {outcome === 'discard'
                  ? t('cull.confirmDiscard', { count: selected.length })
                  : t('cull.confirmDonate', { count: selected.length })}
              </p>
              <ul className="check-list list-unbounded">
                {selected.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.description || it.typeClass}
                      <span className="hint" dir="ltr">
                        {' '}
                        {it.serialNumber}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
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
