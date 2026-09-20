import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n } from '../../../shared/i18n';
import { disposalCategoryLabel, disposalOutcomeLabel, itemClassLabel } from '../../../shared/itemClasses';
import { POLICY_RULE_HE, REFUSAL_REASON_HE } from './policyText';
import { EmptyState, ErrorState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconBox } from '../../../shared/ui/icons';

/**
 * What Bault accepts, what it refuses, and what happens to the difference.
 *
 * The rules on this page were all being enforced before it existed. The closed
 * item taxonomy has been checked on every intake path since the taxonomy pass;
 * a prohibited arrival has produced a recorded disposal and a notification for
 * just as long. What was missing was the page — so the only way to learn the
 * rule was to break it, and find out when something you posted was destroyed.
 *
 * Everything below is fetched from `GET /content/intake-policy`, which builds it
 * at request time from the same modules the intake path validates against. That
 * is the whole design: a hand-written policy page is a second copy of a rule,
 * and a second copy drifts silently the first time somebody adds a class. Here
 * it cannot — the page and the validator read the same array.
 *
 * The endpoint is public, deliberately. The failure this closes is somebody
 * posting a box without knowing the rule, and a person deciding whether to use
 * Bault at all has to be able to read what it will take before they have an
 * account to read it with.
 */

interface AcceptedClass {
  key: string;
  label: string;
  oversized: boolean;
  lotEligible: boolean;
  lotMinSize?: number;
  typicalWeightGrams: number;
}

interface RefusedCategory {
  key: string;
  label: string;
  prohibited: boolean;
  reason: string;
}

/** The outcomes arrive either as keys or as `{ key, label }` rows. */
function outcomeKey(outcome: unknown): string {
  if (typeof outcome === 'string') return outcome;
  const row = outcome as { key?: unknown };
  return typeof row?.key === 'string' ? row.key : String(outcome);
}

interface IntakePolicy {
  acceptedClasses: AcceptedClass[];
  refusedCategories: RefusedCategory[];
  outcomes: unknown[];
  lotThreshold: number;
  rules: { id: string; heading: string; body: string }[];
}

export function IntakePolicyPanel() {
  const { t, locale } = useI18n();
  // The API builds this page from the modules that enforce the rules, and holds
  // its prose in English; `policyText.ts` is the Hebrew for the same ids.
  const he = locale === 'he';
  const [policy, setPolicy] = useState<IntakePolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setPolicy(await api.get<IntakePolicy>('/content/intake-policy'));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!policy) return <p className="hint">{t('grp.loading')}</p>;

  // A judgement about value is not a refusal, and putting the two under one
  // heading would tell somebody their box of commons was "prohibited".
  const refused = policy.refusedCategories.filter((c) => c.prohibited);
  const judgement = policy.refusedCategories.filter((c) => !c.prohibited);

  return (
    <>
      <Panel title={t('policy.accepted.title')} subtitle={t('policy.accepted.subtitle')} flush>
        {policy.acceptedClasses.length === 0 ? (
          <EmptyState title={t('policy.accepted.empty')} text="" icon={<IconBox />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('policy.col.item')}</th>
                  <th scope="col">{t('policy.col.storage')}</th>
                  <th scope="col">{t('policy.col.lots')}</th>
                  <th scope="col" className="td-end">
                    {t('policy.col.weight')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {policy.acceptedClasses.map((c) => (
                  <tr key={c.key}>
                    <td data-label={t('policy.col.item')}>
                      <span className="dt-primary">{itemClassLabel(t, c.key)}</span>
                    </td>
                    <td data-label={t('policy.col.storage')}>
                      {c.oversized ? (
                        <StatusBadge tone="warning">{t('policy.storage.oversized')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">{t('policy.storage.standard')}</StatusBadge>
                      )}
                    </td>
                    <td data-label={t('policy.col.lots')}>
                      {!c.lotEligible
                        ? t('policy.lot.never')
                        : c.lotMinSize
                          ? t('policy.lot.threshold', { count: c.lotMinSize })
                          : t('policy.lot.any')}
                    </td>
                    <td data-label={t('policy.col.weight')} className="td-end num">
                      {c.typicalWeightGrams} g
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="panel-note">
          {t('policy.accepted.footnote')}
        </p>
      </Panel>

      <Panel title={t('policy.refused.title')} subtitle={t('policy.refused.subtitle')}>
        <ul className="check-list list-unbounded">
          {refused.map((c) => (
            <li key={c.key}>
              <span>
                <strong>{disposalCategoryLabel(t, c.key)}</strong>
                <span className="hint"> {(he && REFUSAL_REASON_HE[c.key]) || c.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {judgement.length > 0 && (
        <Panel title={t('policy.judgement.title')} subtitle={t('policy.judgement.subtitle')}>
          <ul className="check-list list-unbounded">
            {judgement.map((c) => (
              <li key={c.key}>
                <span>
                  <strong>{disposalCategoryLabel(t, c.key)}</strong>
                  <span className="hint"> {(he && REFUSAL_REASON_HE[c.key]) || c.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t('policy.rules.title')}>
        <div className="stack">
          {policy.rules.map((r) => {
            const text = (he && POLICY_RULE_HE[r.id]) || r;
            return (
              <div key={r.id}>
                <h3 className="policy-rule-heading">{text.heading}</h3>
                <p className="hint measure">{text.body}</p>
              </div>
            );
          })}
        </div>
        <p className="field-hint">
          {t('policy.outcomes', {
            list: policy.outcomes.map((o) => disposalOutcomeLabel(t, outcomeKey(o))).join(', '),
          })}
        </p>
      </Panel>
    </>
  );
}
