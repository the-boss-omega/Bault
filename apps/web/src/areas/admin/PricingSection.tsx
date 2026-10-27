import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { dollarsToCents, formatDate, formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import type { MembershipTier, TierCatalogue } from '../../shared/membership';
import { Button, EmptyState, Panel, SkeletonTable } from '../../shared/ui/primitives';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { IconPlus, IconReceipt } from '../../shared/ui/icons';
import { PricingCoveragePanel, type PricingCoverage } from './PricingCoveragePanel';

interface PricingRule {
  id: string;
  actionType: string;
  itemClass: string | null;
  description: string | null;
  model: string;
  value: number;
  currency: string;
  billingTrigger: string;
  effectiveFrom: string;
}

const BILLING_TRIGGERS = ['per_event', 'daily', 'weekly', 'monthly'];
const BILLING_LABEL: Record<string, MessageKey> = {
  per_event: 'admin.pricing.billing.perEvent',
  daily: 'admin.pricing.billing.daily',
  weekly: 'admin.pricing.billing.weekly',
  monthly: 'admin.pricing.billing.monthly',
};

const ACTION_LABEL: Record<string, MessageKey> = {
  intake: 'admin.pricing.action.intake',
  storage: 'admin.pricing.action.storage',
  service: 'admin.pricing.action.service',
  shipping: 'admin.pricing.action.shipping',
  marketplace_fee: 'admin.pricing.action.marketplaceFee',
};

const MODEL_LABEL: Record<string, MessageKey> = {
  fixed: 'admin.pricing.model.fixed',
  percentage: 'admin.pricing.model.percentage',
};

function tierRuleParameters(tier: MembershipTier) {
  return {
    storedItems: tier.storedItems,
    insuredShipments: tier.insuredShipments,
    insuredValueCapMinor: tier.insuredValueCapMinor,
    postageCreditMinor: tier.postageCreditMinor,
    commissionWaivedOnMinor: tier.commissionWaivedOnMinor,
  };
}

function percentToBasisPoints(input: string): number | null {
  const cleaned = input.trim().replace(/[%\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** What the price list calls an action the code names with a word of its own: `service_fee:video_review`, said in words. */
function actionWords(type: string): string {
  const words = type.replace(/_/g, ' ').replace(/:/g, ' · ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A rule's value as it is read: dollars for a flat amount, a percentage (held in basis points) for a share. */
function ruleValue(model: string, value: number): string {
  return model === 'fixed' ? formatUsd(value) : `${(value / 100).toFixed(2)}%`;
}

export function PricingSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  const [coverage, setCoverage] = useState<PricingCoverage | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[] | null>(null);
  const [actionType, setActionType] = useState('intake');
  const [itemClass, setItemClass] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<'fixed' | 'percentage'>('fixed');
  const [amount, setAmount] = useState('');
  const [billingTrigger, setBillingTrigger] = useState('per_event');
  const [coverageKey, setCoverageKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setRules(await api.get<PricingRule[]>('/pricing/rules'));
    } catch (e) {
      onError((e as Error).message);
      setRules([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<TierCatalogue>('/membership/tiers')
      .then((c) => setTiers(c.tiers))
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const value = model === 'fixed' ? dollarsToCents(amount) : percentToBasisPoints(amount);
  const catalogue = coverage?.actions ?? [];
  const selected = catalogue.find((a) => a.actionType === actionType) ?? null;
  const tier = tiers?.find((x) => x.feeActionType === actionType) ?? null;
  const ready = selected !== null && tiers !== null;

  async function create() {
    if (value === null || !ready) return;
    try {
      await api.post('/pricing/rules', {
        actionType,
        itemClass: itemClass || undefined,
        description,
        model,
        value,
        billingTrigger,
        ...(tier ? { parameters: tierRuleParameters(tier) } : {}),
      });
      onMsg(t('admin.pricing.created'));
      setAmount('');
      setItemClass('');
      setDescription('');
      setBillingTrigger('per_event');
      setCoverageKey((k) => k + 1);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const actionLabel = (type: string) => {
    const key = ACTION_LABEL[type];
    return key ? t(key) : type;
  };
  const billingKey = BILLING_LABEL[billingTrigger];

  return (
    <>
      <PricingCoveragePanel refreshKey={coverageKey} onError={onError} onLoaded={setCoverage} />

      <Panel title={t('admin.pricing.newRule')} subtitle={t('admin.pricing.newRuleSubtitle')}>
        <div className="request-form">
          <div className="stack stack--tight request-form-fields">
            <div className="form-grid">
              <label className="field">
                <span className="field-label">{t('admin.pricing.col.description')}</span>
                <input
                  placeholder={t('admin.pricing.descriptionPlaceholder')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  dir="auto"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('admin.pricing.col.action')}</span>
                <select
                  value={actionType}
                  onChange={(e) => {
                    setActionType(e.target.value);
                    if (!catalogue.find((a) => a.actionType === e.target.value)?.percentOf)
                      setModel('fixed');
                  }}
                >
                  {(
                    [
                      [
                        'admin.pricing.group.charged',
                        catalogue.filter((a) => a.resolution !== 'code_constant'),
                      ],
                      [
                        'admin.pricing.group.published',
                        catalogue.filter((a) => a.resolution === 'code_constant'),
                      ],
                    ] as const
                  ).map(([label, actions]) =>
                    actions.length === 0 ? null : (
                      <optgroup key={label} label={t(label)}>
                        {actions.map((a) => (
                          <option key={a.actionType} value={a.actionType}>
                            {actionLabel(a.actionType)}
                          </option>
                        ))}
                      </optgroup>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{t('admin.pricing.col.class')}</span>
                <input
                  placeholder={t('admin.pricing.itemClassPlaceholder')}
                  value={itemClass}
                  onChange={(e) => setItemClass(e.target.value)}
                  dir="auto"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('admin.pricing.col.model')}</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as 'fixed' | 'percentage')}
                >
                  <option value="fixed">{t('admin.pricing.model.fixed')}</option>
                  {selected?.percentOf ? (
                    <option value="percentage">{t('admin.pricing.model.percentage')}</option>
                  ) : null}
                </select>
              </label>
              <div className="field">
                <label className="field-label" htmlFor="rule-value">
                  {model === 'fixed'
                    ? t('admin.pricing.amountLabel')
                    : t('admin.pricing.percentLabel')}
                </label>
                <div className="money-input">
                  <span aria-hidden="true">{model === 'fixed' ? '$' : '%'}</span>
                  <input
                    id="rule-value"
                    inputMode="decimal"
                    dir="ltr"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <label className="field">
                <span className="field-label">{t('admin.pricing.col.billing')}</span>
                <select value={billingTrigger} onChange={(e) => setBillingTrigger(e.target.value)}>
                  {BILLING_TRIGGERS.map((b) => {
                    const key = BILLING_LABEL[b];
                    return (
                      <option key={b} value={b}>
                        {key ? t(key) : b}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <p className="field-hint">{t('admin.pricing.billingHint')}</p>
            {tier && (
              <p className="field-hint">
                {t('admin.pricing.tierHint', { count: tier.storedItems })}
              </p>
            )}
            {selected?.resolution === 'code_constant' && (
              <p className="field-hint">{t('admin.pricing.publishedHint')}</p>
            )}
          </div>

          {/* The rule as it will read on the rate card: what it is called, what it charges, and for what. */}
          <aside className="request-slip">
            <DrawerTag
              kicker={t('admin.pricing.newRule')}
              title={
                description.trim() || (
                  <span className="drawer-tag-quiet">
                    {t('admin.pricing.descriptionPlaceholder')}
                  </span>
                )
              }
              amount={ruleValue(model, value ?? 0)}
              lines={[
                { label: t('admin.pricing.col.action'), value: actionLabel(actionType) },
                {
                  label: t('admin.pricing.col.class'),
                  value: itemClass.trim() || t('admin.pricing.allClasses'),
                },
                {
                  label: t('admin.pricing.col.model'),
                  value: t(MODEL_LABEL[model] ?? 'admin.pricing.model.fixed'),
                },
                {
                  label: t('admin.pricing.col.billing'),
                  value: billingKey ? t(billingKey) : billingTrigger,
                },
              ]}
            />
          </aside>

          <div className="row request-form-actions">
            <Button
              variant="gold"
              icon={<IconPlus />}
              disabled={value === null || description.trim() === '' || !ready}
              onClick={create}
            >
              {t('admin.pricing.addRule')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title={t('admin.pricing.heading', { count: rules?.length ?? 0 })}>
        {rules === null ? (
          <SkeletonTable rows={4} columns={6} />
        ) : rules.length === 0 ? (
          <EmptyState title={t('admin.pricing.empty')} icon={<IconReceipt />} />
        ) : (
          <RateCard rules={rules} order={catalogue.map((a) => a.actionType)} locale={locale} />
        )}
      </Panel>
    </>
  );
}

/**
 * Every rule in force, on one card: a group for each action, in the order the price list is read in (what the
 * code charges for), and a line to each rule, with what it is, what it is for, and what it charges. A rate
 * card is read, not edited: a rule is added, and takes effect, but is not changed.
 */
function RateCard({
  rules,
  order,
  locale,
}: {
  rules: PricingRule[];
  order: string[];
  locale: string;
}) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const byAction = new Map<string, PricingRule[]>();
    for (const rule of rules)
      byAction.set(rule.actionType, [...(byAction.get(rule.actionType) ?? []), rule]);
    const rank = (type: string) => {
      const at = order.indexOf(type);
      return at === -1 ? order.length : at;
    };
    return [...byAction.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([type, list]) => ({
        type,
        rules: [...list].sort(
          (a, b) =>
            (a.itemClass ?? '').localeCompare(b.itemClass ?? '') ||
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        ),
      }));
  }, [rules, order]);

  return (
    <div className="ledger-sheet rate-card">
      <div className="rate-columns">
        {groups.map((group) => {
          const labelKey = ACTION_LABEL[group.type];
          const id = `rate-${group.type.replace(/[^a-z0-9]+/gi, '-')}`;
          return (
            <section
              key={group.type}
              className="rate-group"
              aria-labelledby={id}
              data-action={group.type}
            >
              <h3 className="rate-group-title" id={id}>
                {labelKey ? t(labelKey) : actionWords(group.type)}
              </h3>
              <ul className="rate-lines">
                {group.rules.map((rule) => {
                  const billing = BILLING_LABEL[rule.billingTrigger];
                  return (
                    <li key={rule.id} className="rate-line">
                      <p className="rate-line-name">{rule.description ?? '—'}</p>
                      <p className="rate-line-meta">
                        {[
                          rule.itemClass ?? t('admin.pricing.allClasses'),
                          billing ? t(billing) : rule.billingTrigger,
                          `${t('admin.pricing.col.effectiveFrom')} ${formatDate(rule.effectiveFrom, locale)}`,
                        ].join(' · ')}
                      </p>
                      <span className="rate-line-value amount" dir="ltr">
                        {ruleValue(rule.model, rule.value)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
