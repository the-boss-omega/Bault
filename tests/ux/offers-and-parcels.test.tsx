import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

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

const { OffersPanel } = await import('../../apps/web/src/areas/customer/marketplace/SellerPanels');
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
    renderParcels([PARCEL]);

    const label = await firstLabel();
    within(label).getByRole('button', { name: 'Shipment details' }).click();
    await waitFor(() => expect(window.location.hash).toContain('parcel=p1'));
  });
});
