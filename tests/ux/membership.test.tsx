import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The membership screen, driven as somebody deciding whether to subscribe.
 *
 * The cases that matter are about CONSENT, because a subscription is the most
 * consequential control in the product: it is the only one that charges again
 * next month without being pressed again. So the price has to be on the button,
 * the button has to confirm, and the screen has to say what happens when an
 * allowance runs out — which is the question the whole scheme lives or dies on.
 */

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
  // `errorText` asks the module which failure this was.
  apiErrorKey: () => null,
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
    // A column per tier, and the price in the heading rather than three
    // separate cards with one of them scaled up.
    expect(within(table).getByText('Folio')).toBeInTheDocument();
    expect(within(table).getByText('Registry')).toBeInTheDocument();
    expect(within(table).getByText('Trust')).toBeInTheDocument();
    expect(within(table).getAllByText('$39.00 a month').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('$699.00 a month').length).toBeGreaterThan(0);

    // And the rows are the benefits, compared across the columns.
    expect(within(table).getByText('Items in storage')).toBeInTheDocument();
    expect(within(table).getByText('Items booked in (a month)')).toBeInTheDocument();
  });

  it('never renders a Join button without the price beside it', async () => {
    answer();
    renderPage();

    // `.offer` is the component that makes this structural: the price and the
    // control are one node. Every join control has to sit inside one.
    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    expect(joins).toHaveLength(3);
    for (const button of joins) {
      const offer = button.closest('.offer');
      expect(offer).toBeTruthy();
      expect(offer!.querySelector('.amount')?.textContent).toMatch(/\$\d/);
    }
  });

  it('confirms before charging, and says what recurring means', async () => {
    const user = userEvent.setup();
    answer();
    renderPage();

    const joins = await screen.findAllByRole('button', { name: /^join$/i });
    await user.click(joins[0]!);

    // Nothing has been charged yet.
    expect(post).not.toHaveBeenCalled();

    // The sentence names the amount, the cycle, AND what happens at the limit —
    // that it goes back to the ordinary price and only after approval.
    const confirmText = await screen.findByText(/every 30 days until you cancel/i);
    expect(confirmText.textContent).toMatch(/\$39\.00/);
    expect(confirmText.textContent).toMatch(/only after you approve it/i);

    post.mockResolvedValue({ tier: 'folio', status: 'active', chargedMinor: 3_900 });
    await user.click(screen.getByRole('button', { name: /confirm and charge/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/membership/subscribe', { tier: 'folio' }));
  });

  it('states that running out never charges automatically', async () => {
    // The promise the whole scheme rests on, on the screen rather than in terms.
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
    // A spent allowance reads as 0 left of 4 — not as an error, just a fact.
    expect(screen.getByText('0 left of 4')).toBeInTheDocument();
  });

  it('publishes what no tier covers, on the same screen', async () => {
    answer();
    renderPage();

    // The pass-throughs and the penalties, named. A membership page that only
    // lists inclusions is the half of the page people complain about later.
    expect(await screen.findByText(/carrier postage beyond the monthly credit/i)).toBeInTheDocument();
    expect(screen.getByText(/the graders’ own fees/i)).toBeInTheDocument();
    expect(screen.getByText(/hand delivery/i)).toBeInTheDocument();
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
    // The other two are switchable; the current one is not offered again.
    expect(screen.getAllByRole('button', { name: /switch to this/i })).toHaveLength(2);
  });
});
