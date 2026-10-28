import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { billableActions, coverage } from '../../apps/api/src/modules/prc/billable-actions';
import { MEMBERSHIP_TIERS } from '../../apps/api/src/modules/mem/tiers';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const UNPRICED = JSON.parse(JSON.stringify(coverage(billableActions(), []))) as ReturnType<
  typeof coverage
>;
const TIERS = {
  tiers: MEMBERSHIP_TIERS.map((t) => ({ ...t, priceMinor: t.listPriceMinor })),
  uncovered: [],
  cycleDays: 30,
  currency: 'USD',
};

const rule = (
  id: string,
  actionType: string,
  description: string,
  value: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  actionType,
  itemClass: null,
  description,
  model: 'fixed',
  value,
  currency: 'USD',
  billingTrigger: 'per_event',
  effectiveFrom: '2026-10-27T12:00:00.000Z',
  ...extra,
});

const RULES = [
  rule(
    'r1',
    'parcel_forwarding',
    'Second leg, charged only to parcels sent to a forwarding address',
    400,
  ),
  rule('r2', 'intake', 'Intake handling fee per received item', 500),
  rule('r3', 'intake', 'Intake: A single card', 100, { itemClass: 'trading_card' }),
  rule('r4', 'marketplace_fee', 'Marketplace commission charged to the seller on every sale', 500, {
    model: 'percentage',
  }),
  rule('r5', 'storage', '180 days included, then 10% of the item intake fee', 100, {
    billingTrigger: 'daily',
  }),
];

function api(rules: unknown[] = RULES) {
  get.mockImplementation(async (path: string) => {
    if (path === '/pricing/rules') return rules;
    if (path === '/admin/pricing/coverage') return UNPRICED;
    if (path === '/membership/tiers') return TIERS;
    return [];
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

afterEach(() => {
  vi.useRealTimers();
});

async function pricing() {
  window.location.hash = '#/admin/pricing';
  const view = render(
    <I18nProvider>
      <AdminConsole currentUserId="me" />
    </I18nProvider>,
  );
  // The action picker is full once the coverage check has come back.
  const picker = (await screen.findByRole('combobox', { name: /^action/i })) as HTMLSelectElement;
  await waitFor(() =>
    expect(picker.querySelector('option[value="parcel_forwarding"]')).not.toBeNull(),
  );
  return view;
}

describe('a pricing rule, written on a slip as it is typed', () => {
  const slip = () => document.querySelector('.request-slip .drawer-tag') as HTMLElement;

  it('says what is not yet written, in the quieter ink, and charges nothing until there is a figure', async () => {
    api();
    await pricing();
    expect(slip()).toHaveAccessibleName('New rule');
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent(
      'Rule description',
    );
    // No figure is typed, so none is written (not a zero: a rule that charges nothing is a rule).
    expect(slip().querySelector('.drawer-tag-amount')?.textContent).toBe('—');
    const line = (name: string) => within(slip()).getByText(name).nextElementSibling;
    expect(line('Action')).toHaveTextContent('Intake');
    expect(line('Class')).toHaveTextContent('All');
    expect(line('Model')).toHaveTextContent('Flat amount');
    expect(line('Billing')).toHaveTextContent('Per event');
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled();
  });

  it('writes no figure for what is not a price, a zero among it: a dash, and the rule is not added', async () => {
    api();
    const user = userEvent.setup();
    await pricing();
    await user.type(screen.getByPlaceholderText('Rule description'), 'Something free');
    await user.type(screen.getByLabelText('Flat amount'), '0');
    expect(slip().querySelector('.drawer-tag-amount')?.textContent).toBe('—');
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled();
  });

  it('follows the description, the action, the class, the figure and the billing as they are chosen', async () => {
    api();
    const user = userEvent.setup();
    await pricing();
    await user.type(screen.getByPlaceholderText('Rule description'), 'Forwarding a parcel');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^action/i }),
      'parcel_forwarding',
    );
    await user.type(screen.getByPlaceholderText('Item class (blank = all)'), 'trading_card');
    await user.type(screen.getByLabelText('Flat amount'), '4.5');
    await user.selectOptions(screen.getByRole('combobox', { name: /^billing/i }), 'monthly');

    expect(slip().querySelector('.drawer-tag-title')).toHaveTextContent('Forwarding a parcel');
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).toBeNull();
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$4.50');
    const line = (name: string) => within(slip()).getByText(name).nextElementSibling;
    expect(line('Action')).toHaveTextContent('parcel_forwarding');
    expect(line('Class')).toHaveTextContent('trading_card');
    expect(line('Billing')).toHaveTextContent('Monthly');
  });

  it('writes a share as a percentage, where the action is one that has a share', async () => {
    api();
    const user = userEvent.setup();
    await pricing();
    await user.selectOptions(screen.getByRole('combobox', { name: /^action/i }), 'marketplace_fee');
    await user.selectOptions(screen.getByRole('combobox', { name: /^model/i }), 'percentage');
    await user.type(screen.getByLabelText('Percentage', { selector: 'input' }), '2.5');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('2.50%');
    expect(within(slip()).getByText('Model').nextElementSibling).toHaveTextContent('Percentage');
  });

  it('adds what the slip shows, and only that', async () => {
    api();
    post.mockResolvedValue({});
    const user = userEvent.setup();
    await pricing();
    await user.type(screen.getByPlaceholderText('Rule description'), 'Forwarding a parcel');
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^action/i }),
      'parcel_forwarding',
    );
    await user.type(screen.getByLabelText('Flat amount'), '4.5');
    await user.click(screen.getByRole('button', { name: /add rule/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/pricing/rules',
      expect.objectContaining({
        actionType: 'parcel_forwarding',
        description: 'Forwarding a parcel',
        model: 'fixed',
        value: 450,
        billingTrigger: 'per_event',
      }),
    );
  });
});

describe('the rules in force, a rate card', () => {
  it('is a group to each action, in the order of the price list, and a line to each rule', async () => {
    api();
    await pricing();
    const groups = Array.from(document.querySelectorAll('.rate-group'));
    expect(groups.map((g) => g.getAttribute('data-action'))).toEqual(
      ['intake', 'parcel_forwarding', 'storage', 'marketplace_fee'].sort(
        (a, b) =>
          UNPRICED.actions.findIndex((x) => x.actionType === a) -
          UNPRICED.actions.findIndex((x) => x.actionType === b),
      ),
    );
    const intake = document.querySelector('[data-action="intake"]') as HTMLElement;
    expect(within(intake).getByRole('heading', { level: 3 })).toHaveTextContent('Intake');
    const lines = within(intake).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    // Within an action, the rule for every class comes before the rules for a class of its own.
    expect(lines[0]).toHaveTextContent('Intake handling fee per received item');
    expect(lines[0]).toHaveTextContent('$5.00');
    expect(lines[0]).toHaveTextContent('All · Per event');
    expect(lines[1]).toHaveTextContent('trading_card · Per event');
    expect(lines[1]).toHaveTextContent('$1.00');
  });

  it('says a share as a percentage, an action with no word of its own as the code it is, and when a rule began', async () => {
    api();
    await pricing();
    const share = document.querySelector('[data-action="marketplace_fee"]') as HTMLElement;
    expect(within(share).getByRole('heading', { level: 3 })).toHaveTextContent('Marketplace fee');
    expect(share).toHaveTextContent('5.00%');
    // The product has no word for this action: the heading is its code, not a phrase the page made up from it.
    const forwarding = document.querySelector('[data-action="parcel_forwarding"]') as HTMLElement;
    const title = within(forwarding).getByRole('heading', { level: 3 });
    expect(title).toHaveTextContent('parcel_forwarding');
    expect(title.querySelector('.code-inline[dir="ltr"]')).not.toBeNull();
    expect(forwarding).toHaveTextContent(/Effective from Oct 2[67], 2026/);
    expect(
      (document.querySelector('[data-action="storage"]') as HTMLElement).textContent,
    ).toContain('Daily');
  });

  it('shows the rule in force, and keeps the ones it replaced under it, quiet and struck through', async () => {
    // A newer rule for the same action and class: the one that is charged. (The clock is set: rules are
    // dated, and which one is in force is a matter of what day it is.)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T00:00:00.000Z') });
    api([
      ...RULES,
      rule('r6', 'intake', 'Intake handling fee, raised', 600, {
        effectiveFrom: '2026-10-28T10:00:00.000Z',
      }),
    ]);
    await pricing();
    const intake = document.querySelector('[data-action="intake"]') as HTMLElement;
    const lines = within(intake).getAllByRole('listitem');
    expect(lines).toHaveLength(3);
    // All classes: the newer rule first, in force; then the one it replaced. Then the class of its own.
    expect(lines[0]).toHaveTextContent('Intake handling fee, raised');
    expect(lines[0]).not.toHaveClass('is-replaced');
    expect(lines[0].querySelector('del')).toBeNull();
    expect(lines[1]).toHaveTextContent('Intake handling fee per received item');
    expect(lines[1]).toHaveClass('is-replaced');
    expect(lines[1].querySelector('del')).toHaveTextContent('$5.00');
    // Another class is its own rule: nothing replaced it.
    expect(lines[2]).not.toHaveClass('is-replaced');
    expect(lines[2].querySelector('del')).toBeNull();
    // The count is of the rules there are.
    expect(screen.getByRole('heading', { name: 'Pricing rules (6)' })).toBeInTheDocument();
  });

  it('does not strike a rule that has not begun yet, and does not count it as the one in force', async () => {
    api([
      ...RULES,
      rule('r7', 'intake', 'Intake from next year', 900, { effectiveFrom: '2099-01-01T00:00:00.000Z' }),
    ]);
    await pricing();
    const intake = document.querySelector('[data-action="intake"]') as HTMLElement;
    const lines = within(intake).getAllByRole('listitem');
    const next = lines.find((l) => l.textContent?.includes('Intake from next year'))!;
    expect(next).toHaveClass('is-upcoming');
    expect(next.querySelector('del')).toBeNull();
    // The rule that is charged now is still the one before it.
    const now = lines.find((l) => l.textContent?.includes('Intake handling fee per received item'))!;
    expect(now).not.toHaveClass('is-replaced');
    expect(now).not.toHaveClass('is-upcoming');
  });

  it('says a line about a rule in the order the page reads, a class as the code it is and a date as a date', async () => {
    api();
    await pricing();
    const meta = document.querySelector('[data-action="intake"] .rate-line:nth-child(2) .rate-line-meta') as HTMLElement;
    expect(meta.querySelector('.code-inline[dir="ltr"]')).toHaveTextContent('trading_card');
    expect(meta.querySelector('.date')).not.toBeNull();
    // Not a sentence made by joining strings, which a browser would read in the direction of its first letter.
    expect(getComputedStyle(meta).unicodeBidi).not.toBe('plaintext');
  });

  it('counts its rules in its heading, and says when there are none', async () => {
    api([]);
    await pricing();
    expect(await screen.findByRole('heading', { name: 'Pricing rules (0)' })).toBeInTheDocument();
    expect(screen.getByText('No pricing rules defined.')).toBeInTheDocument();
    expect(document.querySelector('.rate-card')).toBeNull();
  });
});
