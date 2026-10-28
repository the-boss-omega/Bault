import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { tierLabel, type GradingTier } from '../../../shared/grading';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Button, MoneyField, StatusBadge } from '../../../shared/ui/primitives';

export function GradingForm({
  item,
  onCancel,
  onDone,
  onError,
}: {
  item: { id: string };
  onCancel: () => void;
  onDone: (message: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const [tiers, setTiers] = useState<GradingTier[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [tierKey, setTierKey] = useState('');
  const [declared, setDeclared] = useState('');
  const [busy, setBusy] = useState(false);

  // The menu this form took the place of is gone, and with it the control that was focused.
  useEffect(() => heading.current?.focus(), []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<{ tiers: GradingTier[]; walkthroughThresholdMinor: number }>(
          '/services/grading/tiers',
        );
        setTiers(data.tiers);
        setThreshold(data.walkthroughThresholdMinor);
        if (data.tiers[0]) setTierKey(data.tiers[0].key);
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  const tier = useMemo(() => tiers.find((x) => x.key === tierKey), [tiers, tierKey]);
  const cents = dollarsToCents(declared);

  const problems: string[] = [];
  if (tier && cents !== null && cents > 0) {
    if (cents > tier.maxDeclaredMinor) {
      problems.push(t('grade.problem.ceiling', { amount: formatUsd(tier.maxDeclaredMinor) }));
    }
    if (tier.requiresApproval && cents < threshold) {
      problems.push(t('grade.problem.tooLow', { amount: formatUsd(threshold) }));
    }
  }

  const ready = Boolean(tier) && cents !== null && cents > 0 && problems.length === 0;

  async function submit() {
    if (!tier || cents === null) return;
    setBusy(true);
    try {
      await api.post('/services/grading', { itemId: item.id, tier: tier.key, declaredMinor: cents });
      onDone(t('services.gradingRequested'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // What has not been chosen or typed yet is a dash, never a figure made up.
  const quiet = <span className="drawer-tag-quiet">—</span>;
  const fee = tier?.feeMinor ?? null;

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading" ref={heading} tabIndex={-1}>
        {t('grade.title')}
      </h3>

      <div className="request-form request-form--stacked">
        {/* The request as it will be read by the grader's desk: the fee, what the tier is, what was declared. */}
        <aside className="request-slip">
          <DrawerTag
            kicker={t('grade.slip.fee')}
            amount={fee !== null ? formatUsd(fee) : '—'}
            lines={[
              { label: t('grade.tier'), value: tier ? tierLabel(t, tier) : quiet },
              {
                label: t('grade.slip.turnaround'),
                value: tier
                  ? t('grade.slip.days', {
                      min: tier.turnaroundDaysMin,
                      max: tier.turnaroundDaysMax,
                    })
                  : quiet,
              },
              {
                label: t('grade.slip.ceiling'),
                value: tier ? formatUsd(tier.maxDeclaredMinor) : quiet,
              },
              {
                label: t('grade.declared'),
                value: cents !== null && cents > 0 ? formatUsd(cents) : quiet,
              },
            ]}
            status={
              tier && fee === null ? (
                <StatusBadge tone="warning">{t('grade.feeUnknown')}</StatusBadge>
              ) : tier?.requiresApproval ? (
                <StatusBadge tone="info">{t('grade.slip.approval')}</StatusBadge>
              ) : undefined
            }
            note={t('grade.awayNote')}
          />
        </aside>

        <div className="stack stack--tight request-form-fields">
          <label className="field">
            <span className="field-label">{t('grade.tier')}</span>
            <select value={tierKey} onChange={(e) => setTierKey(e.target.value)}>
              {tiers.map((x) => (
                <option key={x.key} value={x.key}>
                  {tierLabel(t, x)}
                </option>
              ))}
            </select>
          </label>

          <MoneyField
            label={t('grade.declared')}
            value={declared}
            onChange={setDeclared}
            hint={t('grade.declaredHint')}
          />

          {problems.length > 0 && (
            <ul className="check-list list-unbounded">
              {problems.map((p) => (
                <li key={p}>
                  <StatusBadge tone="error" plain>
                    {p}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="row request-form-actions">
          <Button variant="primary" disabled={busy || !ready} onClick={() => void submit()}>
            {t('grade.submit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
