import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');

const COUNTRIES = [
  { code: 'US', name: 'United States', domestic: true, regionRequired: false, regions: [] },
  { code: 'CA', name: 'Canada', domestic: false, regionRequired: true, regions: [{ code: 'ON', name: 'Ontario' }] },
];
const CATALOGUE = {
  services: [],
  addOns: [],
  boxes: [],
  maxInsuredValueMinor: 500_000,
  signatureRequiredAboveMinor: 50_000,
  paymentWindowDays: 7,
};
const ADDRESS = { id: 'a1', label: 'Home', recipient: 'Red Ashwood', line1: '12 Vine St', city: 'Trenton', region: 'NJ', country: 'US', postalCode: '08608', isDefault: true };
const TORONTO = { id: 'a2', label: 'Toronto', recipient: 'Red Ashwood', line1: '1 Front St', city: 'Toronto', region: 'ON', country: 'CA', postalCode: 'M5J 2N8', isDefault: true };
const ITEMS = [
  { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza' },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: '2003 Pokémon EX Dragon — Rayquaza' },
];
const RATE = {
  carrier: 'USPS',
  serviceLevel: 'Priority',
  serviceKey: 'usps_priority',
  costMinor: 700,
  currency: 'USD',
  estimatedDays: 3,
  problems: [],
  eligible: true,
  transitDaysMin: 2,
  transitDaysMax: 3,
  maxInsuredValueMinor: 100_000,
  handlingMinor: 300,
  insurancePremiumMinor: 0,
  addOnsMinor: 0,
  totalMinor: 1000,
  recommended: true,
};
const GROUND = {
  ...RATE,
  serviceLevel: 'Ground',
  serviceKey: 'usps_ground',
  costMinor: 345,
  transitDaysMin: 2,
  transitDaysMax: 2,
  handlingMinor: 300,
  totalMinor: 645,
  recommended: false,
};
const FEDEX_REFUSED = {
  ...RATE,
  carrier: 'FedEx',
  serviceLevel: '2Day',
  serviceKey: 'fedex_2day',
  totalMinor: 10_000,
  eligible: false,
  recommended: false,
  problems: [{ rule: 'origin_facility', message: 'Ships only from DE', limit: 'DE' }],
};
const QUOTE = {
  destination: { country: 'US', postalCode: '08608' },
  totalWeightGrams: 120,
  boxSize: null,
  weightEstimated: false,
  itemCount: 2,
  insuredValueMinor: 0,
  declaredValueMinor: 0,
  signatureRequired: false,
  needsCustoms: false,
  rates: [RATE, GROUND, FEDEX_REFUSED],
  optionProblems: [] as { field: string; message: string }[],
};
const GUIDANCE = {
  universal: [
    'A commercial invoice is generated for every international parcel.',
    'Import duty, VAT and any carrier brokerage are payable by the recipient on arrival. They are not included in the shipping price you are quoted.',
  ],
  specific: {
    country: 'CA',
    name: 'Canada',
    authority: { name: 'Canada Border Services Agency', url: 'https://www.cbsa-asfc.gc.ca/' },
    notes: [],
    notHandled: ['Carrier brokerage fees are billed to the recipient on delivery.'],
  },
};

let addresses: unknown[] = [ADDRESS];
let shipments: unknown[] = [];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  window.location.hash = '';
  addresses = [ADDRESS];
  shipments = [];
  get.mockImplementation(async (path: string) => {
    if (path === '/shipping/countries') return COUNTRIES;
    if (path === '/shipping/services') return CATALOGUE;
    if (path === '/me/addresses') return addresses;
    if (path === '/shipping/shipments') return shipments;
    if (path === '/finance/wallet') return { amount: 5000, currency: 'USD' };
    if (path.startsWith('/shipping/destinations/')) return GUIDANCE;
    return [];
  });
  post.mockImplementation(async (path: string) => {
    if (path === '/shipping/quote') return QUOTE;
    if (path === '/shipping/shipments') return { id: 'shp-1', code: 'SHP-NEW00001' };
    if (path.endsWith('/select-rate')) return { status: 'rates_selected', cost: 645 };
    return {};
  });
});

function composer(onCreated = () => {}) {
  return render(
    <I18nProvider>
      <ShipmentComposer items={ITEMS} onCreated={onCreated} />
    </I18nProvider>,
  );
}

const shipmentPosts = () => post.mock.calls.filter(([path]) => path === '/shipping/shipments');

async function pickBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: /SN-CL10-0005/ }));
  await user.click(screen.getByRole('checkbox', { name: /SN-DR97-0001/ }));
}

async function toStep(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await waitFor(
    async () => {
      if (!screen.queryByRole('heading', { name })) await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    },
    { timeout: 4000 },
  );
}

describe('a shipment, written on a slip while it is chosen', () => {
  it('says where it goes, how many are going and what it comes to once the items and the address are chosen', async () => {
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    expect(slip).toHaveTextContent('Choose the items to send.');
    await waitFor(() => expect(within(slip).getByText('Destination').nextElementSibling).toHaveTextContent('Trenton, United States'));

    await pickBoth(user);
    await waitFor(() => expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$10.00'));
    expect(slip).toHaveTextContent('2 selected');
    expect(slip).toHaveTextContent('2–3 days');
    expect(shipmentPosts()).toHaveLength(0);
  });

  it('adds what was asked for as it is asked for: express, the cover and the signature it makes necessary', async () => {
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    await pickBoth(user);
    await toStep(user, /How/);
    expect(within(slip).queryByText('Express shipping')).not.toBeInTheDocument();

    const extras = screen.getByText('Packing and extras').closest('details')!;
    expect(extras.open).toBe(false);
    await user.click(screen.getByText('Packing and extras'));
    await user.click(screen.getByRole('checkbox', { name: 'Express shipping' }));
    expect(within(slip).getByText('Express shipping')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Insured value'), '600');
    expect(within(slip).getByText('Insured value').nextElementSibling).toHaveTextContent('$600.00');
    expect(within(slip).getByText('Signature on delivery')).toBeInTheDocument();
  });

  it('writes the services the way they are read: one day count, no zero charges, the price apart from the reason', async () => {
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await toStep(user, /How/);

    const ground = (await screen.findByRole('radio', { name: /USPS Ground Advantage/ })).closest('label')!;
    expect(ground).toHaveTextContent('2 days');
    expect(ground).not.toHaveTextContent('2–2 days');
    expect(ground).not.toHaveTextContent('insurance $0.00');

    const refused = screen.getByText('FedEx 2Day').closest('li')!;
    expect(refused.querySelector('.service-option-price')).toHaveTextContent('$100.00');
    expect(refused.querySelector('.service-refused-reason')).toHaveTextContent('Ships only from DE');
    expect(refused.querySelector('.service-option-price')).not.toBe(refused.querySelector('.service-refused-reason'));
  });

  it('shows a problem under the field it is about, and the slip says why there is no price', async () => {
    post.mockImplementation(async (path: string) =>
      path === '/shipping/quote'
        ? {
            ...QUOTE,
            rates: [{ ...RATE, eligible: false, recommended: false, problems: [{ rule: 'insurance', message: 'x', limit: '$1,000.00' }] }],
            optionProblems: [{ field: 'insuredValueMinor', message: 'Cover stops at $5,000.00 on one parcel. Split it across two.' }],
          }
        : {},
    );
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    await pickBoth(user);
    await waitFor(() => expect(slip).toHaveTextContent('Cover stops at $5,000.00 on one parcel.'));
    expect(slip).not.toHaveTextContent('Choose the items');
    await toStep(user, /Where/);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: /How/ });

    const insured = screen.getByLabelText('Insured value');
    const field = insured.closest('.field') as HTMLElement;
    expect(within(field).getByText('Cover stops at $5,000.00 on one parcel. Split it across two.')).toBeInTheDocument();
  });
});

describe('nothing is booked until the button that names the amount', () => {
  it('choosing a service changes only the slip, and "Book and pay" books that service', async () => {
    const onCreated = vi.fn();
    composer(onCreated);
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    await pickBoth(user);
    await toStep(user, /How/);

    expect(await screen.findByRole('radio', { name: /USPS Priority Mail/ })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /USPS Ground Advantage/ }));
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$6.45');
    expect(slip).toHaveTextContent('USPS Ground Advantage · 2 days');
    expect(shipmentPosts()).toHaveLength(0);
    expect(post.mock.calls.some(([path]) => String(path).includes('select-rate') || String(path).includes('choose-for-me'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const review = await screen.findByRole('region', { name: 'Price' });
    expect(review).toHaveTextContent('Wallet after paying');
    expect(review).toHaveTextContent('$43.55');
    expect(shipmentPosts()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Book and pay $6.45' }));
    await waitFor(() => expect(shipmentPosts()).toHaveLength(1));
    expect(post).toHaveBeenCalledWith('/shipping/shipments/shp-1/select-rate', { carrier: 'USPS', serviceLevel: 'Ground' });
    expect(onCreated).toHaveBeenCalled();
  });

  it('puts the confirmation in place of the form, with the code and the way to track it, and starts clean after', async () => {
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await toStep(user, /How/);
    await user.type(screen.getByLabelText(/SN-CL10-0005/), '300');
    await toStep(user, /Review/);
    await user.click(await screen.findByRole('button', { name: /^Book and pay/ }));

    expect(await screen.findByRole('heading', { name: 'Shipment SHP-NEW00001 booked' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track it' })).toHaveAttribute(
      'href',
      '#/shipping-services/tracking?shipment=shp-1',
    );

    await user.click(screen.getByRole('button', { name: 'Ship more items' }));
    expect(await screen.findByRole('heading', { name: /Items/ })).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    const slip = screen.getByRole('region', { name: 'Price' });
    expect(slip).toHaveTextContent('Choose the items to send.');
    expect(slip).not.toHaveTextContent('Insured value');
  });

  it('says the parcel is held, and for how long, when the wallet is short', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/shipping/quote') return QUOTE;
      if (path === '/shipping/shipments') return { id: 'shp-2', code: 'SHP-HELD0001' };
      if (path.endsWith('/select-rate')) return { status: 'awaiting_payment', cost: 1000, shortfallMinor: 400 };
      return {};
    });
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await toStep(user, /Review/);
    await user.click(screen.getByRole('button', { name: 'Book and pay $10.00' }));
    expect(await screen.findByRole('heading', { name: 'Shipment SHP-HELD0001 is waiting for payment' })).toBeInTheDocument();
    expect(screen.getByText(/\$4\.00 short\. The parcel is held for 7 days/)).toBeInTheDocument();
  });
});

describe('an item already on its way is not offered again', () => {
  it('is dimmed with the shipment it is on, and cannot be ticked', async () => {
    shipments = [
      { id: 's9', code: 'SHP-OPEN0009', status: 'rates_selected', itemIds: ['i1'] },
      { id: 's8', code: 'SHP-GONE0008', status: 'delivered', itemIds: ['i2'] },
    ];
    composer();
    const claimed = await screen.findByText('On SHP-OPEN0009');
    const box = screen.getByRole('checkbox', { name: /SN-CL10-0005/ });
    expect(box).toBeDisabled();
    expect(claimed.closest('li')).toHaveClass('is-claimed');
    expect(screen.getByRole('checkbox', { name: /SN-DR97-0001/ })).toBeEnabled();
    expect(screen.queryByText('On SHP-GONE0008')).not.toBeInTheDocument();
  });

  it('finds an item by its serial or its name when there are many', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      serialNumber: `SN-MANY-000${i}`,
      typeClass: 'trading_card',
      description: i === 4 ? 'Rayquaza Gold Star' : `Rayquaza ex ${i}`,
    }));
    render(
      <I18nProvider>
        <ShipmentComposer items={many} onCreated={() => {}} />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    await user.type(await screen.findByRole('searchbox', { name: 'Find an item' }), 'gold star');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Find an item' }));
    await user.type(screen.getByRole('searchbox', { name: 'Find an item' }), 'SN-MANY-0002');
    expect(screen.getByRole('checkbox', { name: /Rayquaza ex 2/ })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });
});

describe('the form starts from the Vault and keeps what was picked', () => {
  it('starts with the items the Vault sent picked, and takes them out of the address', async () => {
    window.location.hash = '#/shipping-services/shipping?items=i1%2Ci2';
    composer();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /SN-CL10-0005/ })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /SN-DR97-0001/ })).toBeChecked();
    await waitFor(() => expect(window.location.hash).toBe('#/shipping-services/shipping'));
  });

  it('saves a new address in place, country first, and the picked items stay picked', async () => {
    addresses = [];
    const saved = { ...ADDRESS, id: 'a9', label: 'Office', city: 'Newark', isDefault: false };
    post.mockImplementation(async (path: string) => {
      if (path === '/me/addresses') {
        addresses = [saved];
        return saved;
      }
      if (path === '/shipping/quote') return QUOTE;
      return {};
    });
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const form = (await screen.findByText('New address', { selector: 'legend' })).closest('fieldset')!;
    const labels = Array.from(form.querySelectorAll('.form-grid .field-label')).map((l) => l.textContent);
    expect(labels[0]).toBe('Country');

    await user.click(within(form).getByRole('button', { name: 'Save and use this address' }));
    expect(within(form).getByText(/Still needed: Country, Label/)).toBeInTheDocument();
    expect(post.mock.calls.some(([path]) => path === '/me/addresses')).toBe(false);

    await user.selectOptions(within(form).getByLabelText(/^Country/), 'US');
    await user.type(within(form).getByLabelText(/^Label/), 'Office');
    await user.type(within(form).getByLabelText(/^Recipient name/), 'Red Ashwood');
    await user.type(within(form).getByLabelText(/^Street and number/), '1 Broad St');
    await user.type(within(form).getByLabelText(/^City/), 'Newark');
    await user.type(within(form).getByLabelText(/^Postal code/), '07102');
    await user.click(within(form).getByRole('button', { name: 'Save and use this address' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/me/addresses', expect.objectContaining({ country: 'US', label: 'Office' })),
    );
    expect(await screen.findByRole('radio', { name: /Office/ })).toBeChecked();
    const slip = screen.getByRole('region', { name: 'Price' });
    expect(slip).toHaveTextContent('2 selected');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('checkbox', { name: /SN-CL10-0005/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /SN-DR97-0001/ })).toBeChecked();
  });
});

describe('a value per item, typed once', () => {
  it('fills the insured value and, abroad, the customs line for each item, and shows the duties before paying', async () => {
    addresses = [TORONTO];
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    await pickBoth(user);
    await waitFor(() => expect(slip).toHaveTextContent('customs needs a value for every item'));
    await toStep(user, /How/);

    await user.type(screen.getByLabelText(/SN-CL10-0005/), '300');
    await user.type(screen.getByLabelText(/SN-DR97-0001/), '1,200');
    expect(screen.getByLabelText('Insured value')).toHaveValue('1500.00');
    expect(screen.getByText('Declared to customs: $1,500.00 in all, one line per item.')).toBeInTheDocument();

    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        '/shipping/quote',
        expect.objectContaining({
          insuredValueMinor: 150_000,
          declaredValueMinor: 150_000,
          perItemCustomsValues: { i1: 30_000, i2: 120_000 },
        }),
      ),
    );
    expect(screen.getByText('Duties and taxes in Canada')).toBeInTheDocument();
    expect(screen.getByText(/payable by the recipient on arrival/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const review = await screen.findByRole('region', { name: 'Price' });
    expect(within(review).getByText('Customs declared').nextElementSibling).toHaveTextContent('$1,500.00');
    expect(within(review).getByText('Duties and VAT').nextElementSibling).toHaveTextContent('Paid by the recipient');
    expect(within(review).getByText('SN-DR97-0001').closest('.ledger-line')).toHaveTextContent('$1,200.00');

    await user.click(screen.getByRole('button', { name: /^Book and pay/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/shipping/shipments',
        expect.objectContaining({ perItemCustomsValues: { i1: 30_000, i2: 120_000 }, declaredValueMinor: 150_000 }),
      ),
    );
  });

  it('asks for the missing value next to that item before it goes abroad', async () => {
    addresses = [TORONTO];
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await toStep(user, /How/);
    await user.type(screen.getByLabelText(/SN-CL10-0005/), '300');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const field = screen.getByLabelText(/SN-DR97-0001/).closest('.field') as HTMLElement;
    expect(within(field).getByText('Customs needs a value for this item.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /How/ })).toBeInTheDocument();
  });
});

describe('sending it with other collectors', () => {
  it('creates the request without a service and opens a shared parcel from the form', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/shipping/quote') return QUOTE;
      if (path === '/shipping/shipments') return { id: 'shp-3', code: 'SHP-SHARE003' };
      if (path === '/shipping/groups') return { id: 'g1', code: 'GRP-ABCD1234' };
      return {};
    });
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Send it with other collectors' }));
    await toStep(user, /Review/);
    await user.click(screen.getByRole('button', { name: 'Send the request and open the parcel' }));

    expect(await screen.findByRole('heading', { name: /SHP-SHARE003 sent and the shared parcel opened/ })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/shipping/groups', { shipmentId: 'shp-3', notes: undefined });
    expect(post.mock.calls.some(([path]) => String(path).includes('select-rate'))).toBe(false);
    expect(screen.getByText(/GRP-ABCD1234/)).toBeInTheDocument();
  });

  it('joins a parcel by its code', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/shipping/quote') return QUOTE;
      if (path === '/shipping/shipments') return { id: 'shp-4', code: 'SHP-JOIN0004' };
      return {};
    });
    composer();
    const user = userEvent.setup();
    await pickBoth(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Send it with other collectors' }));
    await user.click(screen.getByRole('radio', { name: 'Join one with a code' }));
    await user.type(screen.getByLabelText('Parcel code'), 'GRP-ZZZZ9999');
    await toStep(user, /Review/);
    await user.click(screen.getByRole('button', { name: 'Send the request and join' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/shipping/groups/join', { groupCode: 'GRP-ZZZZ9999', shipmentId: 'shp-4' }),
    );
  });
});
