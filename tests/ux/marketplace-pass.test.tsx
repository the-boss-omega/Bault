import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { MarketplacePage } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');
const { StorePage } = await import('../../apps/web/src/areas/customer/marketplace/StorePage');
const { EscrowTab } = await import('../../apps/web/src/areas/customer/marketplace/EscrowTab');
const { resetProfileRequest } = await import('../../apps/web/src/shared/session');

type Routes = Record<string, unknown | (() => unknown)>;

function serve(routes: Routes) {
  get.mockImplementation((path: string) => {
    const key = Object.keys(routes).find((k) => (k.endsWith('*') ? path.startsWith(k.slice(0, -1)) : path === k));
    if (key === undefined) return Promise.resolve([]);
    const value = routes[key];
    const result = typeof value === 'function' ? (value as () => unknown)() : value;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
}

const LISTING = (id: string, serial: string, seller: string, price: number) => ({
  id,
  askingPrice: price,
  currency: 'USD',
  serialNumber: serial,
  typeClass: 'trading_card',
  conditionGrade: 'Near Mint',
  description: `Card ${serial}`,
  sellerUsername: seller,
});

const VAULT = [
  { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: 'Call of Legends Rayquaza', lifecycleState: 'stored' },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: 'Dragon Rayquaza ex', lifecycleState: 'stored' },
];

function market(hash: string, routes: Routes) {
  serve({ '/me/profile': { id: 'u-red', username: 'red' }, '/vault/items*': VAULT, ...routes });
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <MarketplacePage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  resetProfileRequest();
  window.location.hash = '';
});

describe('browse', () => {
  it('shows your own listing as yours, to manage, and never offers to buy it', async () => {
    market('#/marketplace', {
      '/marketplace/listings*': [LISTING('l1', 'SN-OWN-0001', 'red', 5000), LISTING('l2', 'SN-THEM-0001', 'noam', 7000)],
    });
    const mine = (await screen.findByText('Card SN-OWN-0001')).closest('li')!;
    await waitFor(() => expect(within(mine).getByText('Your listing')).toBeInTheDocument());
    expect(within(mine).queryByRole('button', { name: 'Buy' })).not.toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    const theirs = screen.getByText('Card SN-THEM-0001').closest('li')!;
    expect(within(theirs).getByRole('button', { name: 'Buy' })).toBeInTheDocument();
  });

  it('says the listings did not load, and loads them again on Try again', async () => {
    const user = userEvent.setup();
    let fail = true;
    market('#/marketplace', {
      '/marketplace/listings*': () => (fail ? new Error('The server is resting') : [LISTING('l2', 'SN-THEM-0001', 'noam', 7000)]),
    });
    expect(await screen.findByText('The server is resting')).toBeInTheDocument();
    expect(screen.queryByText('No active listings')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Card SN-THEM-0001')).toBeInTheDocument();
  });

  it('says next to the price filters what is wrong with them', async () => {
    market('#/marketplace?min=abc', { '/marketplace/listings*': [] });
    expect(await screen.findByText('Type a price in dollars, like 25 or 25.50.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Price from' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('says when the lowest price is above the highest, and does not send the range', async () => {
    market('#/marketplace?min=50&max=10', { '/marketplace/listings*': [] });
    expect(await screen.findByText('This is below the lowest price. Swap the two.')).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/marketplace\/listings\?/)));
    const calls = get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/marketplace/listings?'));
    expect(calls.every((p) => !p.includes('maxPrice'))).toBe(true);
  });
});

describe('browse past the first page', () => {
  it('says more are waiting, and Show more adds the next page after the last one shown', async () => {
    const all = Array.from({ length: 60 }, (_, i) => LISTING(`l${i}`, `SN-MORE-${String(i).padStart(4, '0')}`, 'noam', 1000 + i));
    get.mockImplementation((path: string) => {
      if (path === '/me/profile') return Promise.resolve({ id: 'u-red', username: 'red' });
      if (!path.startsWith('/marketplace/listings?')) return Promise.resolve([]);
      const params = new URL(path, 'http://x').searchParams;
      const limit = Number(params.get('limit') ?? 50);
      const cursor = params.get('cursor');
      const start = cursor ? all.findIndex((l) => l.id === cursor) + 1 : 0;
      return Promise.resolve(all.slice(start, start + limit));
    });
    window.location.hash = '#/marketplace';
    render(
      <I18nProvider>
        <MarketplacePage />
      </I18nProvider>,
    );
    expect(await screen.findByText('50 listings shown, more below')).toBeInTheDocument();
    expect(screen.queryByText('Card SN-MORE-0055')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show more listings' }));
    expect(await screen.findByText('Card SN-MORE-0055')).toBeInTheDocument();
    expect(screen.getByText('60 listings')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more listings' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/marketplace/listings?limit=50&cursor=l49');
  });
});

describe('sell', () => {
  it('opens with the item the vault asked for already chosen, by id or by serial', async () => {
    market('#/marketplace/sell?item=i2', {});
    const radio = await screen.findByRole('radio', { name: /SN-DR97-0001/ });
    await waitFor(() => expect(radio).toBeChecked());
  });

  it('takes a serial as well', async () => {
    market('#/marketplace/sell?serial=SN-DR97-0001', {});
    const radio = await screen.findByRole('radio', { name: /SN-DR97-0001/ });
    await waitFor(() => expect(radio).toBeChecked());
  });

  it('says so when the item asked for cannot be listed, and falls back to the first', async () => {
    market('#/marketplace/sell?item=gone', {});
    const radio = await screen.findByRole('radio', { name: /SN-CL10-0005/ });
    await waitFor(() => expect(radio).toBeChecked());
    expect(screen.getByText(/is not in your vault in a state that can be listed/)).toBeInTheDocument();
  });

  it('makes up no price, says next to the field what is wrong, and lists on Enter', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    market('#/marketplace/sell', {});
    const price = await screen.findByRole('textbox', { name: 'Asking price' });
    expect(price).toHaveValue('');
    await user.type(price, 'lots');
    await user.tab();
    expect(screen.getByText('Type a price in dollars, like 500 or 1250.00.')).toBeInTheDocument();
    await user.clear(price);
    await user.type(price, '1250{Enter}');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/listings', { itemId: 'i1', askingPrice: 125_000 }));
    expect(await screen.findByText(/^Listed .*Call of Legends Rayquaza.* at \$1,250\.00\./)).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/marketplace/listings'));
  });
});

const OFFER = {
  id: 'o1',
  listingId: 'l1',
  amount: 275_000,
  currency: 'USD',
  status: 'pending',
  createdAt: '2026-11-01T10:00:00.000Z',
  askingPrice: 320_000,
  listingStatus: 'active',
  serialNumber: 'SN-DX107-0003',
  typeClass: 'trading_card',
  description: 'Gold Star Rayquaza',
  buyerUsername: 'golden',
  sellerUsername: 'red',
  direction: 'incoming',
  side: 'seller',
  proposedBy: 'buyer',
  yourTurn: true,
};

describe('offers', () => {
  it('asks before an accept sells the card, naming the buyer and the price', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    market('#/marketplace/offers', { '/marketplace/offers/mine': [OFFER] });
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(post).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Sell at this price' });
    expect(dialog).toHaveTextContent('@golden');
    expect(dialog).toHaveTextContent('$2,750.00');
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/offers/o1/respond', { action: 'accept' }));
  });

  it('names the seller on an offer you made', async () => {
    market('#/marketplace/offers', {
      '/marketplace/offers/mine': [
        { ...OFFER, direction: 'outgoing', side: 'buyer', proposedBy: 'buyer', yourTurn: false, buyerUsername: 'red', sellerUsername: 'noam' },
      ],
    });
    const slip = (await screen.findByText('You made', { selector: '.pill' })).closest('li')!;
    expect(within(slip).getByRole('link', { name: "noam's storefront" })).toBeInTheDocument();
  });

  it('says next to the counter amount what is wrong, and Escape puts the buttons back', async () => {
    const user = userEvent.setup();
    market('#/marketplace/offers', { '/marketplace/offers/mine': [OFFER] });
    await user.click(await screen.findByRole('button', { name: 'Counter' }));
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    await user.clear(amount);
    await user.type(amount, 'many{Enter}');
    expect(await screen.findByText('Type an amount in dollars, like 250 or 250.50.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('shows a refused answer on the offer it was about', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('The listing is no longer active'));
    market('#/marketplace/offers', { '/marketplace/offers/mine': [OFFER] });
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn down this offer' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    const slip = screen.getByText('You received', { selector: '.pill' }).closest('li')!;
    expect(await within(slip).findByText('The listing is no longer active')).toBeInTheDocument();
  });

  it('can be narrowed to the offers received or made', async () => {
    const user = userEvent.setup();
    market('#/marketplace/offers', {
      '/marketplace/offers/mine': [
        OFFER,
        { ...OFFER, id: 'o2', description: 'Other card', direction: 'outgoing', side: 'buyer', yourTurn: false },
      ],
    });
    await screen.findByText('Gold Star Rayquaza');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'outgoing');
    expect(screen.queryByText('Gold Star Rayquaza')).not.toBeInTheDocument();
    expect(screen.getByText('Other card')).toBeInTheDocument();
  });
});

describe('my listings', () => {
  const MINE = {
    id: 'l1',
    itemId: 'i1',
    askingPrice: 320_000,
    currency: 'USD',
    status: 'active',
    publishedAt: '2026-10-27T08:00:00.000Z',
    serialNumber: 'SN-DX107-0003',
    typeClass: 'trading_card',
    description: 'Gold Star Rayquaza',
    conditionGrade: null,
    pendingOffers: 2,
  };

  it('reprices on Enter, cancels on Escape, and takes you to the offers waiting', async () => {
    const user = userEvent.setup();
    patch.mockResolvedValue({});
    market('#/marketplace/listings', { '/marketplace/listings/mine': [MINE] });
    await user.click(await screen.findByRole('button', { name: 'Reprice' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New asking price' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reprice' }));
    const input = screen.getByRole('textbox', { name: 'New asking price' });
    await user.clear(input);
    await user.type(input, '3100{Enter}');
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/marketplace/listings/l1', { askingPrice: 310_000 }));
    await user.click(screen.getByRole('button', { name: 'See the 2 open offers' }));
    expect(window.location.hash).toBe('#/marketplace/offers?search=SN-DX107-0003');
  });

  it('opens the Offers tab searched on the listing, so only its offers show', async () => {
    const offer = (id: string, serial: string) => ({
      id,
      listingId: id,
      amount: 1000,
      status: 'pending',
      direction: 'incoming',
      serialNumber: serial,
      typeClass: 'trading_card',
      description: `Card ${serial}`,
      buyerUsername: 'noam',
      sellerUsername: 'red',
      createdAt: '2026-10-27T08:00:00.000Z',
    });
    market('#/marketplace/offers?search=SN-DX107-0003', {
      '/marketplace/offers/mine': [offer('o1', 'SN-DX107-0003'), offer('o2', 'SN-OTHER-0001')],
    });
    expect(await screen.findByRole('searchbox')).toHaveValue('SN-DX107-0003');
    expect((await screen.findAllByText(/SN-DX107-0003/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SN-OTHER-0001/)).not.toBeInTheDocument();
  });

  it('says "the open offer" for one', async () => {
    market('#/marketplace/listings', { '/marketplace/listings/mine': [{ ...MINE, pendingOffers: 1 }] });
    expect(await screen.findByRole('button', { name: 'See the open offer' })).toBeInTheDocument();
  });

  it('does not call a list that failed to load empty', async () => {
    market('#/marketplace/listings', { '/marketplace/listings/mine': new Error('Down for a moment') });
    expect(await screen.findByText('Down for a moment')).toBeInTheDocument();
    expect(screen.queryByText('Nothing listed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('trade', () => {
  it('finds the collector on Enter, says beside the field when there is none, and says what is missing', async () => {
    const user = userEvent.setup();
    market('#/marketplace/trade', { '/marketplace/collectors/nobody': new Error('No collector by that name') });
    const name = await screen.findByRole('textbox', { name: /Username/ });
    expect(screen.getByText('Find the collector first.')).toBeInTheDocument();
    await user.type(name, '@nobody{Enter}');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/collectors/nobody'));
    expect(await screen.findByText('No collector by that name')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('storefront', () => {
  it('gives your own link in full with a copy button, and your cards to manage', async () => {
    market('#/marketplace/store', {
      '/marketplace/sellers/red': { username: 'red', listings: [{ ...LISTING('l1', 'SN-OWN-0001', 'red', 5000) }] },
    });
    expect(await screen.findByText(`${window.location.origin}${window.location.pathname}#/marketplace/store?seller=red`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    const card = (await screen.findByText('Card SN-OWN-0001')).closest('li')!;
    expect(within(card).getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByText('1 listing')).toBeInTheDocument();
  });

  it('opens a storefront on Enter and says beside the field when there is no such seller', async () => {
    const user = userEvent.setup();
    market('#/marketplace/store', { '/marketplace/sellers/ghost': new Error('No such seller') });
    const name = await screen.findByRole('textbox', { name: 'Username' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/marketplace/sellers/red'));
    await waitFor(() => expect(name).toHaveValue('red'));
    await user.clear(name);
    await user.type(name, 'ghost{Enter}');
    expect(await screen.findByText('No such seller')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the house store', () => {
  const PRODUCT = {
    id: 'p1',
    code: 'HS-0001',
    typeClass: 'sealed_pack',
    description: 'Booster pack',
    conditionGrade: null,
    photoRef: null,
    askingPrice: 1000,
    currency: 'USD',
    stock: 3,
  };

  function store(routes: Routes) {
    serve({ '/me/tier': { tier: 'standard', discountBps: 0 }, ...routes });
    return render(
      <I18nProvider>
        <StorePage />
      </I18nProvider>,
    );
  }

  it('says the store did not load, with a retry, rather than that it is empty', async () => {
    store({ '/marketplace/house/listings': new Error('Store unavailable') });
    expect(await screen.findByText('Store unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Nothing in the store right now')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps a refused purchase in the confirmation', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('Not enough in your wallet'));
    store({ '/marketplace/house/listings': [PRODUCT] });
    await user.click(await screen.findByRole('button', { name: 'Buy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    await user.click(within(dialog).getByRole('button', { name: 'Buy' }));
    expect(await within(dialog).findByText('Not enough in your wallet')).toBeInTheDocument();
  });

  it('names the item, Card Embassy and the price in the confirmation and in what it says after', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ orderCode: 'HO-0001', serialNumber: 'SN-HS01-0001' });
    store({ '/marketplace/house/listings': [PRODUCT] });
    expect(await screen.findByText(/3 in stock/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Buy' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm purchase' });
    expect(within(dialog).getByText(/^Buy .Booster pack. from Card Embassy for \$10\.00\? The amount is charged to your wallet now\.$/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Buy' }));
    expect(
      await screen.findByText(
        /^You bought .Booster pack. from Card Embassy for \$10\.00\. It is in your vault as SN-HS01-0001, order HO-0001\. You can sell or ship it once the warehouse has put it on a shelf\.$/,
      ),
    ).toBeInTheDocument();
  });
});

describe('escrow', () => {
  const TERMS = { feeBps: 100, minimumFeeMinor: 2500, minimumValueMinor: 50_000 };
  const DEAL = {
    id: 'd1',
    code: 'ESC-1',
    raiserRole: 'seller',
    myRole: 'buyer',
    raisedByMe: false,
    counterpartyIsMember: true,
    counterpartyName: null,
    counterpartyEmail: null,
    description: 'A card',
    valueMinor: 100_000,
    feeMinor: 2500,
    currency: 'USD',
    status: 'awaiting_release',
    settlement: 'buyer_vault',
    fundingSource: 'wallet',
    fundedAt: '2026-11-01T10:00:00.000Z',
    fundingReference: null,
    inspectedAt: null,
    inspectionMatches: null,
    inspectionNotes: null,
    buyerReleasedAt: null,
    sellerReleasedAt: null,
    closeReason: null,
    createdAt: '2026-11-01T09:00:00.000Z',
  };

  function escrow(routes: Routes) {
    serve({ '/escrow/terms': TERMS, '/escrow/held': { heldMinor: 0 }, '/escrow/mine': [], ...routes });
    return render(
      <I18nProvider>
        <EscrowTab />
      </I18nProvider>,
    );
  }

  it('says beside the email what is wrong with it, and under the button what is still missing', async () => {
    const user = userEvent.setup();
    escrow({});
    expect(await screen.findByText("Type the other side's username.")).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /no Card Embassy account/ }));
    const email = screen.getByRole('textbox', { name: 'Their email' });
    await user.type(email, 'not-an-email');
    await user.tab();
    expect(screen.getByText('Type an email address like name@example.com.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the deal' })).toBeDisabled();
  });

  it('asks before the release, and shows a refusal inside the drawer', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('The deal moved on'));
    escrow({ '/escrow/mine': [DEAL], '/escrow/d1': { deal: DEAL, events: [] } });
    await user.click(await screen.findByRole('row', { name: 'Open deal ESC-1' }));
    const drawer = await screen.findByRole('dialog', { name: 'ESC-1' });
    await user.click(within(drawer).getByRole('button', { name: 'I am satisfied' }));
    expect(post).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: 'Confirm you are satisfied' });
    await user.click(within(confirm).getByRole('button', { name: 'I am satisfied' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/escrow/d1/release', {}));
    expect(await within(screen.getByRole('dialog', { name: 'ESC-1' })).findByText('The deal moved on')).toBeInTheDocument();
  });

  it('says whose move it is in the list, and names the item, the other side and the amount when you confirm', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    escrow({ '/escrow/mine': [DEAL], '/escrow/d1': { deal: DEAL, events: [] } });
    expect(await screen.findByText('Your move: confirm you are satisfied.')).toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: 'Open deal ESC-1' }));
    const drawer = await screen.findByRole('dialog', { name: 'ESC-1' });
    expect(within(drawer).getByText('Paid from the buyer\'s wallet and held by Card Embassy.')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'I am satisfied' }));
    const confirm = await screen.findByRole('dialog', { name: 'Confirm you are satisfied' });
    expect(
      within(confirm).getByText(
        /^Confirm deal ESC-1, .A card. with the seller\? When both sides have confirmed, \$1,000\.00 and the collectible change hands at once\. This cannot be undone\.$/,
      ),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'I am satisfied' }));
    expect(
      (await screen.findAllByText(/^You confirmed deal ESC-1\. When the seller confirms too, \$1,000\.00 and .A card. change hands at once\.$/)).length,
    ).toBeGreaterThan(0);
  });

  it('names the outside seller and the amount before the money goes in, and says what happens next', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({});
    const agreed = {
      ...DEAL,
      status: 'agreed',
      raiserRole: 'buyer',
      raisedByMe: true,
      counterpartyIsMember: false,
      counterpartyName: 'Dana Lee',
      counterpartyEmail: 'dana@example.com',
      fundedAt: null,
      fundingSource: null,
    };
    escrow({ '/escrow/mine': [agreed], '/escrow/d1': { deal: agreed, events: [] } });
    expect(await screen.findByText('Your move: put the money in.')).toBeInTheDocument();
    await user.click(screen.getByRole('row', { name: 'Open deal ESC-1' }));
    const drawer = await screen.findByRole('dialog', { name: 'ESC-1' });
    await user.click(within(drawer).getByRole('button', { name: 'Put $1,025.00 into escrow' }));
    const confirm = await screen.findByRole('dialog', { name: 'Put the money into escrow' });
    expect(
      within(confirm).getByText(
        /^Put \$1,025\.00 into escrow for .A card., bought from .Dana Lee. in deal ESC-1\? It leaves your balance now and is held until the deal settles or is returned\.$/,
      ),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Put the money in' }));
    expect(
      (await screen.findAllByText(/^\$1,025\.00 is held for deal ESC-1\. Next, .Dana Lee. sends .A card. to Card Embassy, and we inspect it when it arrives\.$/)).length,
    ).toBeGreaterThan(0);
  });

  it('says beside the price when it is under the escrow minimum', async () => {
    const user = userEvent.setup();
    escrow({});
    const price = await screen.findByRole('textbox', { name: 'Agreed price' });
    await user.type(price, '100');
    await user.tab();
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(price).toHaveAccessibleDescription(
      'Escrow starts at $500.00. Below that, the fee would cost more than the protection is worth.',
    );
  });
});
