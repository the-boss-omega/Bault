import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The landing page, driven as a first-time visitor drives it.
 *
 * Every case here pins a decision that could be undone by accident, and the two
 * that matter most are about the same thing: WHAT THIS PAGE IS ALLOWED TO SAY
 * ABOUT MONEY.
 *
 * A marketing page is the one surface in a product where a price is normally
 * typed in by hand — a designer writes "from $5" into a hero and it is nobody's
 * job to keep it true. Bault's whole economics are per-item pricing rules, and
 * Principle VI makes those rules the source of truth, so the figure on the front
 * page is fetched from `GET /pricing/list` (which is `@Public()` for exactly
 * this reason) and is NEVER written into the component. The first test proves
 * the figure comes from the response; the second proves that when the response
 * does not arrive, the page shows no figure at all rather than a stale or
 * invented one.
 *
 * `api` is mocked at the module boundary rather than `fetch` being stubbed: the
 * component's contract is "ask for the price list and render what came back",
 * and that is the seam worth pinning.
 */

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

const { LandingPage } = await import('../../apps/web/src/areas/customer/marketing/LandingPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

/** The shape `GET /pricing/list` answers with, trimmed to what this page reads. */
const PRICE_LIST = {
  groups: [
    {
      group: 'intake',
      entries: [
        { actionType: 'intake', model: 'fixed', value: 500, parameters: null },
        {
          actionType: 'storage',
          model: 'fixed',
          value: 100,
          parameters: { freeDays: 180, periodDays: 90, percentOfIntakeBps: 1_000 },
        },
      ],
    },
    {
      group: 'shipping',
      entries: [{ actionType: 'shipping', model: 'fixed', value: 0, parameters: null }],
    },
    {
      group: 'selling',
      entries: [{ actionType: 'marketplace_fee', model: 'percentage', value: 500, parameters: null }],
    },
    {
      group: 'money',
      entries: [{ actionType: 'cash_out_fee', model: 'percentage', value: 150, parameters: null }],
    },
  ],
};

function renderPage() {
  return render(
    <I18nProvider>
      <LandingPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  window.location.hash = '';
});

describe('the landing page', () => {
  it('opens on a real item, with its serial, not on an illustration', async () => {
    get.mockResolvedValue(PRICE_LIST);
    renderPage();

    // The identity, in the component that states it everywhere else in the
    // product. A landing page that promises a different product than the one
    // behind it is a lie told twice.
    expect(screen.getByText('SN-DX107-0003')).toBeInTheDocument();

    // And the photograph of that exact serial — the filename IS the serial, so
    // this cannot drift into being a picture of nothing.
    const photo = document.querySelector('img');
    expect(photo).toBeTruthy();
    expect(photo!.getAttribute('src')).toContain('SN-DX107-0003');

    // Let the price fetch settle before the case ends, so its state update
    // happens inside the test rather than after it (React's act warning).
    await screen.findByText('$5.00');
  });

  it('prices itself from the pricing rules, never from a figure typed into the page', async () => {
    get.mockResolvedValue(PRICE_LIST);
    renderPage();

    await waitFor(() => expect(get).toHaveBeenCalledWith('/pricing/list'));

    // Cents for a fixed rule, basis points for a percentage one — rendering both
    // through the money formatter would turn 5% into "$5.00", which is the exact
    // error a price label exists to prevent.
    expect(await screen.findByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('1.50%')).toBeInTheDocument();

    // $0.00 is PRINTED, not suppressed. Bault adds no handling markup on an
    // outbound parcel, and that is a fact worth stating rather than an absence
    // to hide behind an empty cell.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('states the storage terms from the rule parameters, not from its fallback value', async () => {
    get.mockResolvedValue(PRICE_LIST);
    renderPage();

    // `value` on the storage rule is $1.00 — a fallback base for an item with no
    // intake charge to take a proportion of, and a figure nobody is ever
    // charged. The real terms are in `parameters`, and those are what a reader
    // is shown.
    expect(
      await screen.findByText('180 days included, then 10% of the intake fee every 90 days'),
    ).toBeInTheDocument();
    expect(screen.queryByText('$1.00')).not.toBeInTheDocument();
  });

  it('shows no figure at all when the price list cannot be fetched', async () => {
    get.mockRejectedValue(new Error('unreachable'));
    renderPage();

    // Not a placeholder, not a cached number, not "from $5" — a sentence saying
    // the list could not be loaded. A placeholder here could be read as "free".
    expect(await screen.findByText(/price list could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('$5.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('sends "Open an account" to sign-up and "Sign in" to sign-in', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(PRICE_LIST);
    renderPage();

    // Two calls to action that mean different things. Landing "Open an account"
    // on the sign-in form with a link underneath asks somebody to make the same
    // choice twice.
    const bar = document.querySelector('.landing-bar') as HTMLElement;
    await user.click(within(bar).getByRole('button', { name: /open an account/i }));
    expect(window.location.hash).toBe('#/signup');

    await user.click(within(bar).getByRole('button', { name: /^sign in$/i }));
    expect(window.location.hash).toBe('#/signin');
  });

  it('is one h1 followed by section headings, so it can be read by outline', async () => {
    get.mockResolvedValue(PRICE_LIST);
    renderPage();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // Every section below the stage is labelled by its own heading, which is
    // what `aria-labelledby` on each <section> buys.
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(5);

    await screen.findByText('$5.00');
  });
});
