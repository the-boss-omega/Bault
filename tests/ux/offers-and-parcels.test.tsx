import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const { MyListingsPanel, OffersPanel, SwapsPanel } = await import(
  '../../apps/web/src/areas/customer/marketplace/SellerPanels'
);
const { InboundPage } = await import('../../apps/web/src/areas/customer/inbound/InboundPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const OFFER_BASE = {
  listingId: 'l1',
  status: 'pending',
  createdAt: '2026-10-27T08:00:00.000Z',
  askingPrice: 320_000,
  listingStatus: 'active',
  typeClass: 'trading_card',
  description: '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107',
};

const MADE_BY_ME = {
  ...OFFER_BASE,
  id: 'o-made',
  serialNumber: 'SN-DX107-0003',
  amount: 275_000,
  buyerUsername: null,
  direction: 'outgoing',
  side: 'buyer',
  proposedBy: 'buyer',
  yourTurn: false,
};

const MADE_TO_ME = {
  ...OFFER_BASE,
  id: 'o-got',
  serialNumber: 'SN-DR97-0001',
  amount: 160_000,
  askingPrice: 200_000,
  buyerUsername: 'red',
  direction: 'incoming',
  side: 'seller',
  proposedBy: 'buyer',
  yourTurn: true,
};

function renderOffers() {
  return render(
    <I18nProvider>
      <OffersPanel onChanged={() => {}} onError={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  window.location.hash = '';
});

describe('the offers, one bid slip each', () => {
  function answerOffers() {
    get.mockImplementation((path: string) => {
      if (path === '/marketplace/offers/mine') return Promise.resolve([MADE_BY_ME, MADE_TO_ME]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  }

  it('shows each offer as a list item with its serial, who made it, and the amount named', async () => {
    answerOffers();
    renderOffers();

    const list = await screen.findByRole('list', { name: 'Offers' });
    const slips = within(list).getAllByRole('listitem');
    expect(slips).toHaveLength(2);

    const made = slips[0]!;
    expect(within(made).getByText('SN-DX107-0003')).toBeInTheDocument();
    expect(within(made).getByText('You made')).toBeInTheDocument();
    expect(within(made).getByText('Offer').nextElementSibling).toHaveTextContent('$2,750.00');
    expect(within(made).getByText('Asking $3,200.00')).toBeInTheDocument();

    const got = slips[1]!;
    expect(within(got).getByText('You received')).toBeInTheDocument();
    expect(within(got).getByText('@red')).toBeInTheDocument();
  });

  it('draws how the offer stands against the asking price, and says nothing extra about it', async () => {
    answerOffers();
    renderOffers();

    const slips = within(await screen.findByRole('list', { name: 'Offers' })).getAllByRole('listitem');
    const fill = slips[0]!.querySelector('.slip-gauge > span') as HTMLElement;
    // 2,750 of 3,200 asked is 86 %.
    expect(fill.style.inlineSize).toBe('86%');
    expect(slips[0]!.querySelector('.slip-gauge')).toHaveAttribute('aria-hidden', 'true');
    expect(slips[1]!.querySelector('.slip-gauge > span')).toHaveStyle({ inlineSize: '80%' });
  });

  it('lets the person who made an offer only change or withdraw it, never accept it', async () => {
    answerOffers();
    renderOffers();

    const slips = within(await screen.findByRole('list', { name: 'Offers' })).getAllByRole('listitem');
    const made = slips[0]!;
    expect(within(made).getByRole('button', { name: 'Change offer' })).toBeInTheDocument();
    expect(within(made).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(within(made).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(within(made).getByText('Waiting on the seller')).toBeInTheDocument();
  });

  it('sets the answer that cannot be taken back apart, whichever side gives it', async () => {
    answerOffers();
    renderOffers();

    const slips = within(await screen.findByRole('list', { name: 'Offers' })).getAllByRole('listitem');
    // The maker withdraws; the one it was made to rejects: the same kind of answer, so the same treatment.
    expect(within(slips[0]!).getByRole('button', { name: 'Withdraw' })).toHaveClass('btn--danger');
    expect(within(slips[1]!).getByRole('button', { name: 'Reject' })).toHaveClass('btn--danger');
    expect(within(slips[0]!).getByRole('button', { name: 'Change offer' })).not.toHaveClass('btn--danger');
  });

  it('offers the person it was made to accept, counter and reject', async () => {
    answerOffers();
    renderOffers();

    const slips = within(await screen.findByRole('list', { name: 'Offers' })).getAllByRole('listitem');
    const got = slips[1]!;
    expect(within(got).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(within(got).getByRole('button', { name: 'Counter' })).toBeInTheDocument();
    expect(within(got).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('offers nothing on an offer that is no longer open', async () => {
    get.mockResolvedValue([{ ...MADE_TO_ME, status: 'accepted' }]);
    renderOffers();

    const slip = within(await screen.findByRole('list', { name: 'Offers' })).getByRole('listitem');
    // The photograph is a button too (it opens the lightbox); what must be gone is every action.
    const actions = within(slip)
      .queryAllByRole('button')
      .filter((b) => !b.classList.contains('photo-thumb'));
    expect(actions).toHaveLength(0);
  });
});

const SWAP_BASE = {
  status: 'pending',
  createdAt: '2026-10-27T08:00:00.000Z',
  proposerApproved: false,
  responderApproved: false,
};

/** A swap someone proposed to me: they would get the Deoxys, I would get the Rayquaza. */
const SWAP_TO_ME = {
  ...SWAP_BASE,
  id: 's-in',
  kind: 'swap',
  direction: 'incoming',
  proposerUsername: 'golden',
  responderUsername: 'red',
  offeredItems: [{ id: 'i1', serialNumber: 'SN-DR97-0001', description: 'Rayquaza ★ (Gold Star)' }],
  requestedItems: [{ id: 'i2', serialNumber: 'SN-DX107-0003', description: 'Deoxys — Rayquaza ★' }],
  awaitingMe: true,
};

/** A gift I proposed: the other person would get the card and I would get nothing back. */
const GIFT_BY_ME = {
  ...SWAP_BASE,
  id: 's-gift',
  kind: 'transfer',
  direction: 'outgoing',
  proposerUsername: 'red',
  responderUsername: 'golden',
  offeredItems: [{ id: 'i3', serialNumber: 'SN-ZZ-0001', description: 'A spare holo' }],
  requestedItems: [],
  awaitingMe: false,
};

function renderSwaps(rows: unknown[]) {
  get.mockImplementation((path: string) =>
    path === '/marketplace/swaps' ? Promise.resolve(rows) : Promise.reject(new Error(`unexpected ${path}`)),
  );
  const onChanged = vi.fn();
  render(
    <I18nProvider>
      <SwapsPanel onChanged={onChanged} onError={() => {}} />
    </I18nProvider>,
  );
  return { onChanged };
}

async function tradeSlips(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Swaps and gifts' });
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
}

describe('the trades, one slip each', () => {
  it('sets what each side receives facing the other, every card beside its serial', async () => {
    renderSwaps([SWAP_TO_ME]);

    const [swap] = await tradeSlips();
    expect(within(swap!).getByText('Swap')).toBeInTheDocument();
    expect(within(swap!).getByText('@golden')).toBeInTheDocument();

    const theyGet = within(swap!).getByRole('group', { name: 'They get' });
    expect(within(theyGet).getByText('SN-DX107-0003')).toBeInTheDocument();
    const youGet = within(swap!).getByRole('group', { name: 'You get' });
    expect(within(youGet).getByText('SN-DR97-0001')).toBeInTheDocument();
    expect(within(youGet).queryByText('SN-DX107-0003')).not.toBeInTheDocument();
  });

  it('draws a swap both ways and a gift one way, toward whoever is receiving', async () => {
    renderSwaps([SWAP_TO_ME, GIFT_BY_ME]);

    const [swap, gift] = await tradeSlips();
    expect(swap!.querySelector('.trade-swap')).not.toHaveClass('trade-swap--one');
    expect(swap!.querySelector('.trade-swap')).toHaveAttribute('aria-hidden', 'true');

    expect(within(gift!).getByText('Gift')).toBeInTheDocument();
    expect(gift!.querySelector('.trade-swap')).toHaveClass('trade-swap--one');
    // The card goes to the other person, who is on the start side of the slip.
    expect(gift!.querySelector('.trade-swap')).toHaveClass('trade-swap--back');
    expect(within(within(gift!).getByRole('group', { name: 'You get' })).getByText('—')).toBeInTheDocument();
  });

  it('asks the person it is waiting on to approve or reject, and no one else', async () => {
    renderSwaps([SWAP_TO_ME, GIFT_BY_ME]);

    const [swap, gift] = await tradeSlips();
    expect(within(swap!).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(swap!).getByRole('button', { name: 'Reject' })).toBeInTheDocument();

    expect(within(gift!).getByText('Waiting on them')).toBeInTheDocument();
    expect(within(gift!).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(gift!).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('approves from the slip', async () => {
    post.mockResolvedValue({});
    const { onChanged } = renderSwaps([SWAP_TO_ME]);

    const [swap] = await tradeSlips();
    await act(async () => {
      within(swap!).getByRole('button', { name: 'Approve' }).click();
    });

    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/swaps/s-in/approve'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Approved'));
  });

  it('says so when there are none', async () => {
    renderSwaps([]);
    expect(await screen.findByText('No proposals')).toBeInTheDocument();
  });
});

const LISTING = {
  id: 'l1',
  itemId: 'i1',
  askingPrice: 320_000,
  currency: 'USD',
  status: 'active',
  publishedAt: '2026-10-27T08:00:00.000Z',
  serialNumber: 'SN-DX107-0003',
  typeClass: 'trading_card',
  description: '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star) #107/107',
  conditionGrade: null,
  pendingOffers: 1,
};

function renderListings(rows: unknown[]) {
  get.mockImplementation((path: string) =>
    path === '/marketplace/listings/mine' ? Promise.resolve(rows) : Promise.reject(new Error(`unexpected ${path}`)),
  );
  const onChanged = vi.fn();
  render(
    <I18nProvider>
      <MyListingsPanel onChanged={onChanged} onError={() => {}} />
    </I18nProvider>,
  );
  return { onChanged };
}

async function listingSlips(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'My listings' });
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
}

describe('the listings, one slip each', () => {
  it('puts the price first, named, with the offers waiting on it and where the listing stands', async () => {
    renderListings([LISTING]);

    const [slip] = await listingSlips();
    expect(within(slip!).getByText('SN-DX107-0003')).toBeInTheDocument();
    expect(within(slip!).getByText('Price').nextElementSibling).toHaveTextContent('$3,200.00');
    expect(within(slip!).getByText('Offers').nextElementSibling).toHaveTextContent('1');
    expect(within(slip!).getByText('Active')).toBeInTheDocument();
    expect(within(slip!).getByText(/^Listed/)).toHaveTextContent('Oct 27, 2026');
  });

  it('shows a dash where no offers are waiting', async () => {
    renderListings([{ ...LISTING, pendingOffers: 0 }]);

    const [slip] = await listingSlips();
    expect(within(slip!).getByText('Offers').nextElementSibling).toHaveTextContent('—');
  });

  it('offers a listing that is live a new price or to take it down, and nothing once it is sold', async () => {
    renderListings([LISTING, { ...LISTING, id: 'l2', status: 'sold', serialNumber: 'SN-DR97-0001' }]);

    const [live, sold] = await listingSlips();
    expect(within(live!).getByRole('button', { name: 'Reprice' })).toBeInTheDocument();
    expect(within(live!).getByRole('button', { name: 'Delist' })).toBeInTheDocument();

    const actions = within(sold!)
      .queryAllByRole('button')
      .filter((b) => !b.classList.contains('photo-thumb'));
    expect(actions).toHaveLength(0);
  });

  it('reprices in place, from the price it has', async () => {
    const user = userEvent.setup();
    // Before the panel is on screen: a pause after it renders lets its first load land outside act().
    const patch = (await import('../../apps/web/src/shared/api')).api.patch as ReturnType<typeof vi.fn>;
    patch.mockResolvedValue({});
    const { onChanged } = renderListings([LISTING]);

    const [slip] = await listingSlips();
    await user.click(within(slip!).getByRole('button', { name: 'Reprice' }));
    const input = within(slip!).getByRole('textbox', { name: 'Price' });
    expect(input).toHaveValue('3200.00');

    await user.clear(input);
    await user.type(input, '3100');
    await user.click(within(slip!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Price updated to $3,100.00'));

    expect(patch).toHaveBeenCalledWith('/marketplace/listings/l1', { askingPrice: 310_000 });
    // The panel finishes (it is no longer busy) before the test does.
    await waitFor(() => expect(within(slip!).getByRole('button', { name: 'Reprice' })).toBeEnabled());
  });

  it('asks before it takes a listing down', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ confirmationToken: 'tok' });
    renderListings([LISTING]);

    const [slip] = await listingSlips();
    await user.click(within(slip!).getByRole('button', { name: 'Delist' }));

    const dialog = await screen.findByRole('dialog');
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delist' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/marketplace/listings/l1/remove'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/marketplace/listings/remove/confirm', { confirmationToken: 'tok' }),
    );
  });
});

const PARCEL = {
  id: 'p1',
  code: 'PKG-ZX8WCP9C',
  status: 'received',
  carrier: 'USPS',
  trackingNumber: '9400100000000000000001',
  declaredContents: 'Two raw Rayquaza singles',
  internationalOrigin: false,
  expectedAt: '2026-10-25T09:00:00.000Z',
  receivedAt: '2026-10-27T09:00:00.000Z',
  openedAt: null,
  processedAt: null,
  forwardedAt: null,
  condition: null,
  conditionNotes: null,
  facilityCode: 'NJ',
  facilityName: 'Bault New Jersey',
};

function renderParcels(parcels: unknown[]) {
  get.mockImplementation((path: string) => {
    if (path === '/me/parcels') return Promise.resolve(parcels);
    if (path === '/me/inbound-addresses') return Promise.resolve([]);
    return Promise.resolve([]);
  });
  window.location.hash = '#/inbound/parcels';
  return render(
    <I18nProvider>
      <InboundPage />
    </I18nProvider>,
  );
}

/** The label itself, not the stops of its journey (which are list items too). */
async function firstLabel(): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Your parcels' });
  return list.querySelector(':scope > li') as HTMLElement;
}

describe('the parcels, one label each', () => {
  it('shows how far a parcel has got, with the date of each stop it has reached', async () => {
    renderParcels([PARCEL]);

    const label = await firstLabel();
    expect(within(label).getByText('PKG-ZX8WCP9C')).toBeInTheDocument();
    expect(within(label).getByText('Two raw Rayquaza singles')).toBeInTheDocument();

    const stops = Array.from(label.querySelectorAll<HTMLElement>('.label-track > li'));
    expect(stops).toHaveLength(4);
    expect(stops[0]).toHaveAttribute('data-reached', 'true');
    expect(stops[1]).toHaveAttribute('data-reached', 'true');
    expect(stops[2]).toHaveAttribute('data-reached', 'false');
    expect(stops[3]).toHaveAttribute('data-reached', 'false');
    // The stop it is at is the current step, by what a screen reader hears and not only by what is drawn.
    expect(stops[1]).toHaveAttribute('aria-current', 'step');
    expect(stops.filter((s) => s.getAttribute('aria-current') === 'step')).toHaveLength(1);
  });

  it('prints the tracking number on the stub, left to right, with its carrier', async () => {
    renderParcels([PARCEL]);

    const label = await firstLabel();
    const number = within(label).getByText('9400100000000000000001');
    expect(number.closest('[dir="ltr"]')).toBeTruthy();
    expect(within(label).getByText('USPS')).toBeInTheDocument();
  });

  it('draws no journey for a parcel that is not on it', async () => {
    renderParcels([{ ...PARCEL, status: 'unclaimed' }]);

    const label = await firstLabel();
    await waitFor(() => expect(within(label).getByText('PKG-ZX8WCP9C')).toBeInTheDocument());
    expect(label.querySelector('.label-track')).toBeNull();
  });

  it('opens the parcel from its button, and from the label itself for the pointer', async () => {
    const user = userEvent.setup();
    renderParcels([PARCEL]);

    const label = await firstLabel();
    await user.click(within(label).getByRole('button', { name: 'Shipment details' }));
    await waitFor(() => expect(window.location.hash).toContain('parcel=p1'));

    window.location.hash = '#/inbound/parcels';
    await waitFor(() => expect(window.location.hash).not.toContain('parcel=p1'));
    await user.click(within(label).getByText('Two raw Rayquaza singles'));
    await waitFor(() => expect(window.location.hash).toContain('parcel=p1'));
  });
});
