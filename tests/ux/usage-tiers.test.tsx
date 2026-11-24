import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { TierPage } = await import('../../apps/web/src/areas/customer/tier/TierPage');
const { TierPrice } = await import('../../apps/web/src/shared/ui/TierPrice');
const { forgetViewerTier } = await import('../../apps/web/src/shared/tiers');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { TIER_RULES } = await import('../../apps/api/src/modules/mem/tiers');

const standing = (over: Record<string, unknown> = {}) => ({
  tier: 'silver',
  discountBps: 1_000,
  computedAt: '2026-11-23T01:30:00.000Z',
  window: { days: 90, actions: 14, spentMinor: 61_250 },
  next: { tier: 'gold', minActions: 30, minSpentMinor: 200_000, actionsToGo: 16, spentToGoMinor: 138_750 },
  rules: TIER_RULES,
  honoured: null,
  ...over,
});

function answer(body: unknown) {
  get.mockImplementation((path: string) => {
    if (path === '/tiers/me') return Promise.resolve(body);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

const inI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
  get.mockReset();
  forgetViewerTier();
});

describe('the tier page', () => {
  it('names the tier, the 90-day counts behind it and what reaches the next one', async () => {
    answer(standing());
    inI18n(<TierPage />);

    expect(await screen.findByText('You are Silver')).toBeInTheDocument();
    expect(screen.getByText('Charges in the last 90 days').nextElementSibling).toHaveTextContent('14');
    expect(screen.getByText('Spent in the last 90 days').nextElementSibling).toHaveTextContent('$612.50');
    expect(screen.getByRole('heading', { name: 'To reach Gold' })).toBeInTheDocument();
    expect(screen.getByText(/16 more charges or \$1,387\.50 more spent in 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/already 10% under the list price/)).toBeInTheDocument();
    expect(screen.queryByText(/Your paid membership/)).toBeNull();
  });

  it('shows the discount table, with the account’s own tier marked', async () => {
    answer(standing());
    inI18n(<TierPage />);

    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      'BronzeEvery accountList price',
      'SilverYour tier10 charges or $500.00 in 90 days10% off',
      'Gold30 charges or $2,000.00 in 90 days20% off',
    ]);
    expect(rows[1]).toHaveAttribute('data-current', 'true');
  });

  it('says Gold is the top and keeps itself while the counts hold', async () => {
    answer(standing({ tier: 'gold', discountBps: 2_000, next: null }));
    inI18n(<TierPage />);
    expect(
      await screen.findByText('Gold is the top tier. You keep it while the last 90 days hold 30 charges or $2,000.00 spent.'),
    ).toBeInTheDocument();
  });

  it('lists a paid membership’s allowances while they are honoured', async () => {
    answer(
      standing({
        tier: 'bronze',
        discountBps: 0,
        honoured: {
          tier: 'silver',
          honouredUntil: '2026-12-10T00:00:00.000Z',
          perCycle: {
            intake: { allowed: 10, used: 3, remaining: 7 },
            parcel_processing: { allowed: 5, used: 0, remaining: 5 },
          },
          storedItems: 200,
          insuredShipments: { allowed: 3, used: 0, capMinor: 100_000 },
          postage: { creditMinor: 3_000, usedMinor: 1_200 },
          commission: { waivedOnMinor: 100_000, usedMinor: 0 },
          rushIncluded: true,
        },
      }),
    );
    inI18n(<TierPage />);

    expect(await screen.findByText(/Your paid membership, until/)).toBeInTheDocument();
    expect(screen.getByText('You pay the list price.')).toBeInTheDocument();
    expect(screen.getByText('Items booked in').nextElementSibling).toHaveTextContent('7 left of 10');
    expect(screen.getByText('Items in storage').nextElementSibling).toHaveTextContent('200');
    expect(screen.getByText('Postage credit left').nextElementSibling).toHaveTextContent('$18.00');
  });
});

describe('the price a collector is shown', () => {
  it('is the list price alone for a Bronze account', async () => {
    answer(standing({ tier: 'bronze', discountBps: 0 }));
    const { container } = inI18n(<TierPrice listMinor={1_500} />);
    await screen.findByText('$15.00');
    expect(container.querySelector('s')).toBeNull();
    expect(container).not.toHaveTextContent('price');
  });

  it('is the tier price, named for the tier, with the Bronze price struck through beside it', async () => {
    answer(standing({ tier: 'gold', discountBps: 2_000 }));
    const { container } = inI18n(<TierPrice listMinor={1_500} />);
    expect(await screen.findByText('Gold price')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    const struck = container.querySelector('s.tier-price-list')!;
    expect(struck).toHaveTextContent('$15.00');
    expect(struck).toHaveAccessibleName('Bronze price $15.00');
  });

  it('takes a price the server already worked out as it is, at the tier it was quoted for', async () => {
    answer(standing({ tier: 'bronze', discountBps: 0 }));
    const { container } = inI18n(<TierPrice listMinor={2_345} chargedMinor={2_111} tier="silver" />);
    expect(await screen.findByText('Silver price')).toBeInTheDocument();
    expect(screen.getByText('$21.11')).toBeInTheDocument();
    expect(container.querySelector('s')).toHaveTextContent('$23.45');
  });

  it('prints a share as a share', async () => {
    answer(standing({ tier: 'silver', discountBps: 1_000 }));
    inI18n(<TierPrice listMinor={500} format={(bps) => `${(bps / 100).toFixed(2)}%`} />);
    expect(await screen.findByText('4.50%')).toBeInTheDocument();
    expect(screen.getByText('5.00%')).toBeInTheDocument();
  });

  it('shows the list price to a visitor who is not signed in', async () => {
    get.mockRejectedValue(new Error('unauthenticated'));
    const { container } = inI18n(<TierPrice listMinor={1_500} />);
    expect(await screen.findByText('$15.00')).toBeInTheDocument();
    expect(container.querySelector('s')).toBeNull();
  });
});
