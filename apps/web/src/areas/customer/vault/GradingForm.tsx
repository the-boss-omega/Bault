import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { useI18n } from '../../../shared/i18n';
import { tierLabel, type GradingTier } from '../../../shared/grading';
import { Button, MoneyField, StatusBadge } from '../../../shared/ui/primitives';

/**
 * Send a card away to be graded — at a chosen service level.
 *
 * Grading used to be a single button that posted `{ itemId }` and nothing else.
 * The owner could not say what the card was worth, could not choose how long
 * they were willing to wait, and was never shown the two facts that decide both:
 * the tier's declared-value ceiling and its turnaround.
 *
 * Both rules are evaluated here as well as on the server, and for the same
 * reason the consignment form does it: so somebody is told "that is above this
 * tier's ceiling" while they can still change it, rather than after a fee has
 * been charged. The server re-checks regardless — this is the courtesy, not the
 * control.
 */
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
  const [tiers, setTiers] = useState<GradingTier[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [tierKey, setTierKey] = useState('');
  const [declared, setDeclared] = useState('');
  const [busy, setBusy] = useState(false);

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
    // The inverse guard the server also applies: a common on the top tier is
    // somebody paying several times what they need to.
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

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading">{t('grade.title')}</h3>

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

      {tier && (
        <p className="field-hint">
          <strong>
            {tier.feeMinor === null ? t('grade.feeUnknown') : t('grade.fee', { amount: formatUsd(tier.feeMinor) })}
          </strong>
          {` · ${t('grade.turnaround', { min: tier.turnaroundDaysMin, max: tier.turnaroundDaysMax })}`}
          {` · ${t('grade.ceiling', { amount: formatUsd(tier.maxDeclaredMinor) })}`}
          {tier.requiresApproval && ` · ${t('grade.needsApproval')}`}
        </p>
      )}

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

      <p className="field-hint">{t('grade.awayNote')}</p>

      <div className="row">
        <Button variant="gold" disabled={busy || !ready} onClick={() => void submit()}>
          {t('grade.submit')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.cancel')}
        </Button>
      </div>
    </div>
  );
}
