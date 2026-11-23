import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { act, cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: (...a: unknown[]) => del(...a),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    kind: string;
    constructor(kind: string, status: number, message: string, code: string) {
      super(message);
      this.kind = kind;
      this.status = status;
      this.code = code;
    }
  },
  apiErrorKey: () => null,
}));

const { I18nProvider, hasMessage } = await import('../../apps/web/src/shared/i18n');
const { ApiError } = await import('../../apps/web/src/shared/api');
const { forgetViewerTier } = await import('../../apps/web/src/shared/tiers');
const { ContextTabs } = await import('../../apps/web/src/shared/ui/primitives');
const { PriceListPanel } = await import('../../apps/web/src/areas/customer/help/PriceListPanel');
const { ContactPanel } = await import('../../apps/web/src/areas/customer/help/HelpPanels');
const { FaqLegalPage } = await import('../../apps/web/src/areas/customer/help/FaqLegalPage');
const { AuthPage } = await import('../../apps/web/src/areas/customer/auth/AuthPage');
const { SignUpPage } = await import('../../apps/web/src/areas/customer/auth/SignUpPage');
const { ResetPasswordPage } = await import('../../apps/web/src/areas/customer/auth/ResetPasswordPage');
const { SupportPage } = await import('../../apps/web/src/areas/customer/support/SupportPage');
const { ProfilePage } = await import('../../apps/web/src/areas/customer/profile/ProfilePage');
const { TierPage } = await import('../../apps/web/src/areas/customer/tier/TierPage');
const { AppErrorBoundary } = await import('../../apps/web/src/shared/ui/AppErrorBoundary');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const TIER_BRONZE = {
  tier: 'bronze',
  discountBps: 0,
  computedAt: null,
  window: { days: 90, actions: 5, spentMinor: 4000 },
  next: { tier: 'silver', minActions: 10, minSpentMinor: 50_000, actionsToGo: 5, spentToGoMinor: 46_000 },
  rules: [
    { key: 'bronze', minActions: 0, minSpentMinor: 0, discountBps: 0 },
    { key: 'silver', minActions: 10, minSpentMinor: 50_000, discountBps: 1000 },
    { key: 'gold', minActions: 30, minSpentMinor: 200_000, discountBps: 2000 },
  ],
  honoured: null,
};

const entry = (over: Record<string, unknown>) => ({
  itemClass: null,
  model: 'fixed',
  currency: 'USD',
  billingTrigger: 'per_event',
  parameters: null,
  tierDiscounted: true,
  ...over,
});

const PRICE_LIST = {
  note: '',
  groups: [
    {
      group: 'storage',
      entries: [
        entry({
          actionType: 'storage',
          description: '180 days included, then 10% of the item intake fee every 90 days',
          value: 100,
          billingTrigger: 'daily',
          parameters: { freeDays: 180, periodDays: 90, percentOfIntakeBps: 1000 },
        }),
      ],
    },
    {
      group: 'shipping',
      entries: [
        entry({ actionType: 'shipping', description: 'Handling surcharge added on top of the carrier rate', value: 0 }),
        entry({ actionType: 'shipping_rush', description: 'Same-day picking and packing', value: 1000 }),
      ],
    },
    {
      group: 'selling',
      entries: [
        entry({ actionType: 'marketplace_fee', description: 'Marketplace commission', model: 'percentage', value: 500 }),
        entry({ actionType: 'escrow_fee', description: 'Middleman fee', model: 'percentage', value: 100, tierDiscounted: false }),
      ],
    },
    {
      group: 'money',
      entries: [
        entry({
          actionType: 'cash_out_fee',
          description: 'Cash-out fee: 6% (min $0.99) under $100, otherwise $5.00 + 1%',
          model: 'percentage',
          value: 100,
          tierDiscounted: false,
        }),
      ],
    },
  ],
};

const ACCOUNT_TERMS = {
  cashOut: { bandMinor: 10_000, smallBps: 600, smallMinimumMinor: 99, largeFixedMinor: 500, largeBps: 100 },
};

function routes(map: Record<string, unknown | (() => unknown)>) {
  get.mockImplementation((path: string) => {
    const hit = Object.entries(map).find(([p]) => path.startsWith(p));
    if (!hit) return Promise.resolve([]);
    const value = typeof hit[1] === 'function' ? (hit[1] as () => unknown)() : hit[1];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  forgetViewerTier();
  window.location.hash = '';
});

describe('the price list', () => {
  it('shows percentages without trailing zeros, storage by its period, the cash-out rule in full, and no $0.00 row', async () => {
    routes({ '/pricing/list': PRICE_LIST, '/content/account-terms': ACCOUNT_TERMS, '/tiers/me': TIER_BRONZE });
    renderIn(<PriceListPanel />);

    const rush = await screen.findByText('Same-day picking and packing');
    expect(rush.closest('tr')).toHaveTextContent('$10.00');
    expect(screen.getByText('Marketplace commission').closest('tr')).toHaveTextContent('5%');
    expect(screen.getByText('Marketplace commission').closest('tr')).not.toHaveTextContent('5.00%');

    const storage = screen.getByText(/180 days included/).closest('tr')!;
    expect(storage).toHaveTextContent('10% of the intake fee');
    expect(storage).toHaveTextContent('every 90 days after 180 free days');
    expect(storage).not.toHaveTextContent(/daily/i);

    await waitFor(() =>
      expect(screen.getByText(/^Cash-out fee/).closest('tr')).toHaveTextContent('6% (at least $0.99) up to $100.00; above that, $5.00 plus 1%'),
    );

    expect(screen.queryByText('Handling surcharge added on top of the carrier rate')).not.toBeInTheDocument();
  });

  it('can be searched and narrowed to one group', async () => {
    const user = userEvent.setup();
    routes({ '/pricing/list': PRICE_LIST, '/content/account-terms': ACCOUNT_TERMS, '/tiers/me': TIER_BRONZE });
    renderIn(<PriceListPanel />);
    await screen.findByText('Same-day picking and packing');

    await user.type(screen.getByRole('searchbox', { name: 'Search the price list' }), 'commission');
    expect(screen.getByText('Marketplace commission')).toBeInTheDocument();
    expect(screen.queryByText('Same-day picking and packing')).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search the price list' }));
    await user.click(within(screen.getByRole('group', { name: 'Show one group' })).getByRole('button', { name: 'Shipping' }));
    expect(screen.getByText('Same-day picking and packing')).toBeInTheDocument();
    expect(screen.queryByText('Marketplace commission')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search the price list' }), 'zzzz');
    expect(screen.getByText('No price matches')).toBeInTheDocument();
  });

  it('shows the viewer their tier price, with the list price struck through, and says so above the list', async () => {
    routes({
      '/pricing/list': PRICE_LIST,
      '/content/account-terms': ACCOUNT_TERMS,
      '/tiers/me': { ...TIER_BRONZE, tier: 'silver', discountBps: 1000 },
    });
    renderIn(<PriceListPanel />);
    await waitFor(() => expect(screen.getByText('Same-day picking and packing').closest('tr')).toHaveTextContent('$9.00'));
    expect(screen.getByText('Same-day picking and packing').closest('tr')!.querySelector('s')).toHaveTextContent('$10.00');
    expect(screen.getByTestId('prices-tier')).toHaveTextContent('Silver price, 10% off');
    expect(screen.getByRole('link', { name: 'See your tier' })).toHaveAttribute('href', '#/tier');
    expect(screen.getByText('Middleman fee').closest('tr')!.querySelector('s')).toBeNull();
  });

  it('says when it did not load, without claiming there are no prices, and can try again', async () => {
    const user = userEvent.setup();
    let fail = true;
    routes({
      '/pricing/list': () => (fail ? new Error('offline') : PRICE_LIST),
      '/content/account-terms': ACCOUNT_TERMS,
      '/tiers/me': TIER_BRONZE,
    });
    renderIn(<PriceListPanel />);
    expect(await screen.findByText('The price list did not load')).toBeInTheDocument();
    expect(screen.queryByText('No price list')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Same-day picking and packing')).toBeInTheDocument();
  });
});

describe('the strip of tabs on a phone', () => {
  const tabs = Array.from({ length: 8 }, (_, i) => ({ key: `t${i}`, label: `Section ${i}` }));

  it('marks the side that has more tabs past its edge, and follows the scroll', () => {
    const scroll = { width: 900, client: 390, left: 0 };
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scroll.width);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => scroll.client);
    const sl = vi.spyOn(HTMLElement.prototype, 'scrollLeft', 'get').mockImplementation(() => scroll.left);
    try {
      renderIn(<ContextTabs label="sections" tabs={tabs} active="t0" onSelect={() => {}} />);
      const strip = screen.getByRole('tablist');
      expect(strip.dataset.moreEnd).toBe('true');
      expect(strip.dataset.moreStart).toBe('false');

      scroll.left = 200;
      fireEvent.scroll(strip);
      expect(strip.dataset.moreStart).toBe('true');
      expect(strip.dataset.moreEnd).toBe('true');

      scroll.left = 510;
      fireEvent.scroll(strip);
      expect(strip.dataset.moreStart).toBe('true');
      expect(strip.dataset.moreEnd).toBe('false');
    } finally {
      sw.mockRestore();
      cw.mockRestore();
      sl.mockRestore();
    }
  });

  it('marks nothing when every tab fits', () => {
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => 300);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 390);
    try {
      renderIn(<ContextTabs label="sections" tabs={tabs.slice(0, 2)} active="t0" onSelect={() => {}} />);
      const strip = screen.getByRole('tablist');
      expect(strip.dataset.moreEnd).toBe('false');
      expect(strip.dataset.moreStart).toBe('false');
    } finally {
      sw.mockRestore();
      cw.mockRestore();
    }
  });

  const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
  const CSS = ['index', 'theme', 'components', 'buttons', 'app', 'gallery', 'screens']
    .map((name) => readFileSync(join(SRC, `${name}.css`), 'utf8'))
    .join('\n');
  const BROWSER = '/opt/pw-browsers/chromium';
  let browser: Browser | null = null;
  afterAll(async () => {
    await browser?.close();
  });

  it('at 390 px the help tabs overflow and the strip fades out at the edge that has more', async () => {
    try {
      browser = await chromium.launch(existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' });
    } catch {
      return;
    }
    const help = ['FAQ', 'Guides', 'What we accept', 'Prices', 'Show calendar', 'Contact', 'Legal Terms', 'Ask'].map(
      (label, i) => ({ key: `t${i}`, label }),
    );
    renderIn(<ContextTabs label="FAQ & Legal" tabs={help} active="t0" onSelect={() => {}} />);
    const html = document.body.innerHTML;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(
      `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><style>${CSS}</style></head>` +
        `<body><div class="app-shell"><div class="workspace"><div class="workspace-inner">${html}</div></div></div></body></html>`,
    );
    const at = (left: number) =>
      page.evaluate((x) => {
        const strip = document.querySelector<HTMLElement>('.ctx-tabs')!;
        strip.scrollLeft = x;
        const max = strip.scrollWidth - strip.clientWidth;
        strip.dataset.moreStart = String(max > 1 && strip.scrollLeft > 1);
        strip.dataset.moreEnd = String(max > 1 && strip.scrollLeft < max - 1);
        const style = getComputedStyle(strip);
        return { max, mask: style.maskImage || style.webkitMaskImage };
      }, left);
    const start = await at(0);
    expect(start.max).toBeGreaterThan(0);
    expect(start.mask).toMatch(/linear-gradient/);
    const end = await at(10_000);
    expect(end.mask).toMatch(/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/);
    expect(start.mask).not.toMatch(/^linear-gradient\(to right, (transparent|rgba\(0, 0, 0, 0\))/);
    await page.close();
  });
});

describe('signing in, up and back in', () => {
  it('follows the address: a link to #/forgot opens the reset form, and the form links write the address', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/signin';
    const { rerender } = renderIn(<AuthPage initialMode="signIn" onSignedIn={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(window.location.hash).toBe('#/forgot');
    rerender(
      <I18nProvider>
        <AuthPage initialMode="forgot" onSignedIn={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('sign-up says what is missing when it is pressed, instead of a button that does nothing', async () => {
    const user = userEvent.setup();
    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    const submit = screen.getByRole('button', { name: 'Sign up' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('That does not look like an email address.')).toBeInTheDocument();
    expect(screen.getByText('Tick the box to agree to the terms before you sign up.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));

    await user.type(screen.getByLabelText('Email'), 'ann@example.com');
    await user.type(screen.getByLabelText('Username'), 'annlee');
    await user.type(screen.getByLabelText('First name'), 'Ann');
    await user.type(screen.getByLabelText('Last name'), 'Lee');
    await user.type(screen.getByLabelText('Password'), '12345678');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(post).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('checkbox'));
    post.mockResolvedValueOnce({ username: 'annlee', firstName: 'Ann', lastName: 'Lee' });
    await user.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(post).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ email: 'ann@example.com' }));
  });

  it('an expired reset link offers a new one, and "Back to sign in" goes to sign-in, not the landing page', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(new ApiError('gone', 410, 'gone', 'gone'));
    renderIn(<ResetPasswordPage token="bogus" />);
    await user.type(screen.getByLabelText('New password'), 'abcdefgh1');
    await user.type(screen.getByLabelText('Confirm password'), 'abcdefgh1');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    await user.click(await screen.findByRole('button', { name: 'Ask for a new link' }));
    expect(window.location.hash).toBe('#/forgot');
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(window.location.hash).toBe('#/signin');
  });
});

describe('support tickets', () => {
  const ticket = (id: string, subject: string, status: string, at: string) => ({
    id,
    code: `TKT-${id.toUpperCase()}`,
    category: 'item',
    subject,
    status,
    lastMessageAt: at,
    createdAt: at,
  });

  it('can be searched and filtered by whose turn it is', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/support/tickets';
    routes({
      '/support/tickets': [
        ticket('a1', 'Rayquaza arrived raw', 'awaiting_customer', '2026-11-21T10:00:00Z'),
        ticket('b2', 'Wallet top-up missing', 'open', '2026-11-20T10:00:00Z'),
        ticket('c3', 'Label reprint', 'resolved', '2026-11-19T10:00:00Z'),
      ],
    });
    renderIn(<SupportPage />);
    await screen.findByText('Rayquaza arrived raw');
    await user.click(within(screen.getByRole('group', { name: 'Show tickets that are' })).getByRole('button', { name: 'Waiting for you' }));
    expect(screen.getByText('Rayquaza arrived raw')).toBeInTheDocument();
    expect(screen.queryByText('Wallet top-up missing')).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Show tickets that are' })).getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search your tickets' }), 'tkt-c3');
    expect(screen.getByText('Label reprint')).toBeInTheDocument();
    expect(screen.queryByText('Rayquaza arrived raw')).not.toBeInTheDocument();
  });

  it('a failed load is not shown as "No tickets yet"', async () => {
    window.location.hash = '#/support/tickets';
    routes({ '/support/tickets': new Error('The service is unavailable.') });
    renderIn(<SupportPage />);
    expect(await screen.findByText('The service is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('No tickets yet')).not.toBeInTheDocument();
  });
});

describe('the profile', () => {
  const PROFILE = {
    id: 'u1',
    email: 'red@bault.dev',
    username: 'red',
    role: 'user',
    status: 'active',
    firstName: 'Red',
    lastName: 'Ashwood',
    fullName: 'Red Ashwood',
    nameReviewRequired: false,
  };
  const ADDRESS = {
    id: 'a1',
    label: 'Home',
    recipient: 'Red Ashwood',
    line1: '1200 Market St',
    line2: null,
    city: 'San Francisco',
    region: 'CA',
    country: 'US',
    postalCode: '94102',
    phone: null,
    isDefault: true,
  };

  it('names the address each Edit and Delete is for, and says what a deletion means', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/profile/addresses';
    routes({ '/me/profile': PROFILE, '/me/addresses': [ADDRESS] });
    del.mockResolvedValue(undefined);
    renderIn(<ProfilePage />);
    expect(await screen.findByRole('button', { name: 'Edit address Home' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete address Home' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Address deleted. It is no longer offered when you ship.')).toBeInTheDocument();
  });

  it('a failed load is not shown as "no addresses"', async () => {
    window.location.hash = '#/profile/addresses';
    routes({ '/me/profile': new Error('The service is unavailable.'), '/me/addresses': [] });
    renderIn(<ProfilePage />);
    expect(await screen.findByText('The service is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText(/no saved addresses/i)).not.toBeInTheDocument();
  });
});

describe('help', () => {
  it('opens on the FAQ, with the placeholder assistant last', async () => {
    window.location.hash = '#/faq';
    routes({});
    renderIn(<FaqLegalPage />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('FAQ');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs.at(-1)).toHaveTextContent('Ask');
  });

  it('the contact page leaves out what is not published, and its button opens a new ticket', async () => {
    const user = userEvent.setup();
    routes({ '/content/contact': { email: null, phone: null, hours: null, team: [] }, '/content/locations': [] });
    renderIn(<ContactPanel />);
    await act(async () => {});
    expect(screen.queryByText('Not published')).not.toBeInTheDocument();
    expect(screen.queryByText('Phone')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open a ticket' }));
    expect(window.location.hash).toBe('#/support/new');
  });
});

describe('the tier page', () => {
  it('links to the price list and to how tiers work', async () => {
    routes({ '/tiers/me': TIER_BRONZE });
    renderIn(<TierPage />);
    expect(await screen.findByRole('link', { name: 'See every price on the price list' })).toHaveAttribute('href', '#/faq/prices');
    expect(screen.getByRole('link', { name: 'How tiers work' })).toHaveAttribute('href', '#/faq/faq?q=tiers');
  });

  it('a failed load has a title and a retry', async () => {
    routes({ '/tiers/me': new Error('offline') });
    renderIn(<TierPage />);
    expect(await screen.findByText('Your tier could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the app shell', () => {
  it('the error page offers a reload and a way to tell support', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): React.ReactElement {
      throw new Error('boom');
    }
    render(
      <AppErrorBoundary report={() => {}}>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tell support' })).toHaveAttribute('href', '#/support/new');
    quiet.mockRestore();
  });

  it('the catalogue has lost the unused notification toggle keys', () => {
    expect(hasMessage('notifications.allOn')).toBe(false);
    expect(hasMessage('notifications.allOff')).toBe(false);
    cleanup();
  });
});
