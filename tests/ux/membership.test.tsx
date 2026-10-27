import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { MembershipPage } = await import('../../apps/web/src/areas/customer/membership/MembershipPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { MEMBERSHIP_TIERS, UNCOVERED } = await import('../../apps/api/src/modules/mem/tiers');

const CATALOGUE = {
  tiers: MEMBERSHIP_TIERS.map((t) => ({ ...t, priceMinor: t.listPriceMinor })),
  uncovered: [...UNCOVERED],
  cycleDays: 30,
  currency: 'USD',
};

function answer(membership: unknown = null) {
  get.mockImplementation((path: string) => {
    if (path === '/membership/tiers') return Promise.resolve(CATALOGUE);
    if (path === '/membership/me') return Promise.resolve({ membership });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <MembershipPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('the membership screen', () => {
  it('shows every tier with its price, as one comparison table', async () => {
    answer();
    renderPage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Folio')).toBeInTheDocument();
    expect(within(table).getByText('Registry')).toBeInTheDocument();
    expect(within(table).getByText('Trust')).toBeInTheDocument();
    // The figure is a left-to-right isolate inside the phrase, so it keeps its place when the phrase reads right to left.
    const phrase = (text: string) => (content: string) => content.replace(/[\u2066-\u2069]/g, '') === text;
    expect(within(table).getAllByText(phrase('$39.00 a month')).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(phrase('$699.00 a month')).length).toBeGreaterThan(0);

    expect(within(table).getByText('Items in storage')).toBeInTheDocument();
    expect(within(table).getByText('Items booked in (a month)')).toBeInTheDocument();
  });

  it('never renders a Join button without the price beside it', async () => {
    answer();
    renderPage();

    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    expect(joins).toHaveLength(3);
    for (const button of joins) {
      const offer = button.closest('.offer');
      expect(offer).toBeTruthy();
      expect(offer!.querySelector('.offer-price')?.textContent).toMatch(/\$\d/);
    }
  });

  it('sets the price phrase so that the figure keeps its direction inside a sentence that may read the other way', async () => {
    answer();
    renderPage();

    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    const price = joins[0]!.closest('.offer')!.querySelector('.offer-price')!;
    // Not one left-to-right block (that would put the amount on the wrong side of "per month" in Hebrew): the
    // phrase follows the page, and the amount alone is isolated, by a left-to-right isolate and its terminator.
    expect(price.classList.contains('amount')).toBe(false);
    expect(price.textContent).toBe('\u2066$39.00\u2069 a month');
  });

  it('confirms before charging, and says what recurring means', async () => {
    const user = userEvent.setup();
    answer();
    renderPage();

    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    await user.click(joins[0]!);

    expect(post).not.toHaveBeenCalled();

    const confirmText = await screen.findByText(/every 30 days until you cancel/i);
    expect(confirmText.textContent).toMatch(/\$39\.00/);
    expect(confirmText.textContent).toMatch(/only after you approve it/i);

    post.mockResolvedValue({ tier: 'folio', status: 'active', chargedMinor: 3_900 });
    await user.click(screen.getByRole('button', { name: /confirm and charge/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/membership/subscribe', { tier: 'folio' }));
  });

  it('states that running out never charges automatically', async () => {
    answer({
      tier: 'folio',
      status: 'active',
      cycleLive: true,
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelledAt: null,
      perCycle: { intake: { allowed: 4, used: 4, remaining: 0 } },
      storedItems: 60,
      insuredShipments: { allowed: 1, used: 0, capMinor: 50_000 },
      postage: { creditMinor: 1_000, usedMinor: 0 },
      commission: { waivedOnMinor: 0, usedMinor: 0 },
      perks: ['storage_clock_stops'],
    });
    renderPage();

    expect(await screen.findByText(/never triggers an automatic charge/i)).toBeInTheDocument();
    expect(screen.getByText(/do not roll over/i)).toBeInTheDocument();
    expect(screen.getByText('0 left of 4')).toBeInTheDocument();
  });

  it('publishes what no tier covers, on the same screen', async () => {
    answer();
    renderPage();

    expect(await screen.findByText(/carrier postage beyond the monthly credit/i)).toBeInTheDocument();
    expect(screen.getByText(/the graders’ own fees/i)).toBeInTheDocument();
    expect(screen.getByText(/hand delivery/i)).toBeInTheDocument();
  });

  it('leads each tier card with its main allowances, from the same figures as the schedule', async () => {
    answer();
    renderPage();

    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    const folio = joins[0]!.closest('.offer') as HTMLElement;
    const registry = joins[1]!.closest('.offer') as HTMLElement;

    expect(within(folio).getByText('Items in storage').nextElementSibling).toHaveTextContent('60');
    expect(within(folio).getByText('Items booked in (a month)').nextElementSibling).toHaveTextContent('4');
    expect(within(folio).getByText('Postage credit (a month)').nextElementSibling).toHaveTextContent('$10.00');
    expect(within(registry).getByText('Items in storage').nextElementSibling).toHaveTextContent('200');
  });

  it('marks the card of the tier you are on, and no other', async () => {
    answer({
      tier: 'registry',
      status: 'active',
      cycleLive: true,
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelledAt: null,
      perCycle: { intake: { allowed: 10, used: 2, remaining: 8 } },
      storedItems: 200,
      insuredShipments: { allowed: 3, used: 0, capMinor: 100_000 },
      postage: { creditMinor: 3_000, usedMinor: 0 },
      commission: { waivedOnMinor: 100_000, usedMinor: 0 },
      perks: ['storage_clock_stops'],
    });
    renderPage();

    const mine = (await screen.findByText('Your tier')).closest('.offer');
    expect(mine).toHaveAttribute('data-current', 'true');
    expect(document.querySelectorAll('.offer[data-current="true"]')).toHaveLength(1);
  });

  it('does not offer to join the tier you are already on', async () => {
    answer({
      tier: 'registry',
      status: 'active',
      cycleLive: true,
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelledAt: null,
      perCycle: { intake: { allowed: 10, used: 2, remaining: 8 } },
      storedItems: 200,
      insuredShipments: { allowed: 3, used: 0, capMinor: 100_000 },
      postage: { creditMinor: 3_000, usedMinor: 0 },
      commission: { waivedOnMinor: 100_000, usedMinor: 0 },
      perks: ['storage_clock_stops'],
    });
    renderPage();

    expect(await screen.findByText('Your tier')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /switch to this/i })).toHaveLength(2);
  });
});
