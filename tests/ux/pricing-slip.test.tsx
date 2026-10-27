import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$0.00');
    const line = (name: string) => within(slip()).getByText(name).nextElementSibling;
    expect(line('Action')).toHaveTextContent('Intake');
    expect(line('Class')).toHaveTextContent('All');
    expect(line('Model')).toHaveTextContent('Flat amount');
    expect(line('Billing')).toHaveTextContent('Per event');
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

  it('says a share as a percentage, an action with no word of its own in words, and when a rule began', async () => {
    api();
    await pricing();
    const share = document.querySelector('[data-action="marketplace_fee"]') as HTMLElement;
    expect(within(share).getByRole('heading', { level: 3 })).toHaveTextContent('Marketplace fee');
    expect(share).toHaveTextContent('5.00%');
    const forwarding = document.querySelector('[data-action="parcel_forwarding"]') as HTMLElement;
    expect(within(forwarding).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Parcel forwarding',
    );
    expect(forwarding).toHaveTextContent(/Effective from Oct 2[67], 2026/);
    expect(
      (document.querySelector('[data-action="storage"]') as HTMLElement).textContent,
    ).toContain('Daily');
  });

  it('counts its rules in its heading, and says when there are none', async () => {
    api([]);
    await pricing();
    expect(await screen.findByRole('heading', { name: 'Pricing rules (0)' })).toBeInTheDocument();
    expect(screen.getByText('No pricing rules defined.')).toBeInTheDocument();
    expect(document.querySelector('.rate-card')).toBeNull();
  });
});
