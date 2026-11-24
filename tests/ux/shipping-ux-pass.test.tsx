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

const { I18nProvider, MESSAGES } = await import('../../apps/web/src/shared/i18n');
const { ShippingServicesPage, ShipmentDrawer } = await import('../../apps/web/src/areas/customer/shipping/ShippingServicesPage');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');
const { SharedParcelsTab } = await import('../../apps/web/src/areas/customer/shipping/SharedParcelsTab');
const { ShowPickupPanel } = await import('../../apps/web/src/areas/customer/shipping/HumanFulfilmentPanels');
const { useI18n } = await import('../../apps/web/src/shared/i18n');

const ITEM = {
  id: 'i1',
  serialNumber: 'SN-CL10-0005',
  typeClass: 'trading_card',
  description: 'Rayquaza',
  conditionGrade: null,
  lifecycleState: 'stored',
};

const SHIPMENT = {
  id: 's1',
  code: 'SHP-AAAA1111',
  status: 'shipped',
  recipientName: 'Golden Marsh',
  carrier: 'DHL',
  serviceLevel: 'Express',
  trackingNumber: 'TRK-1',
  labelRefused: null,
  estimatedDeliveryAt: null,
  rush: false,
  cost: 3500,
  currency: 'USD',
  itemIds: ['i1'],
  items: [{ id: 'i1', serialNumber: 'SN-CL10-0005', description: 'Rayquaza' }],
  directParcel: null,
  destinationAddress: '55 Wall St, New York',
  destinationCountry: 'US',
  destinationPostalCode: '10005',
  serviceMode: 'standard',
  fulfilmentMethod: 'carrier',
  quoteMinor: null,
  quoteNotes: null,
  declaredValueMinor: 0,
  insuredValueMinor: 0,
  insurancePremiumMinor: 0,
  signatureRequired: false,
  addOns: [],
  boxSize: null,
  customerNotes: null,
  groupId: null,
  paymentDueAt: null,
  cancelledAt: null,
  cancelReason: null,
  restockingFeeMinor: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: null,
  fulfilledAt: null,
};

const OLDER_UNPAID = {
  ...SHIPMENT,
  id: 's2',
  code: 'SHP-BBBB2222',
  status: 'awaiting_payment',
  recipientName: 'Red Ashwood',
  trackingNumber: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

let routes: Record<string, () => Promise<unknown>> = {};

function serve(map: Record<string, unknown | (() => Promise<unknown>)>) {
  routes = {};
  for (const [path, value] of Object.entries(map)) {
    routes[path] = typeof value === 'function' ? (value as () => Promise<unknown>) : async () => value;
  }
  get.mockImplementation((path: string) => {
    const key = path.startsWith('/vault/items?') ? '/vault/items' : path;
    return routes[key] ? routes[key]!() : Promise.resolve([]);
  });
}

function renderPage(hash: string) {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <ShippingServicesPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  window.location.hash = '';
});

describe('the service requests list', () => {
  it('says the requests could not be loaded, with a retry, and never calls a failed list empty', async () => {
    let fail = true;
    serve({
      '/vault/items': [ITEM],
      '/services/mine': () =>
        fail
          ? Promise.reject(new Error('Network down'))
          : Promise.resolve([
              { id: 'r1', code: 'SR-ONE11111', type: 'professional_photography', status: 'requested', itemId: 'i1', createdAt: '2026-11-01T00:00:00Z', typeFields: null },
            ]),
    });
    const user = userEvent.setup();
    renderPage('#/shipping-services/requests');

    expect(await screen.findByText('Your requests could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No open requests')).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('SR-ONE11111 · SN-CL10-0005')).toBeInTheDocument();
    expect(screen.queryByText('Your requests could not be loaded')).not.toBeInTheDocument();
  });

  it('names each request by its code and card, flags a quote waiting for an answer, and can be searched and sorted', async () => {
    serve({
      '/vault/items': [ITEM],
      '/services/mine': [
        { id: 'r1', code: 'SR-NEWER111', type: 'professional_photography', status: 'requested', itemId: null, createdAt: '2026-11-05T00:00:00Z', typeFields: null },
        {
          id: 'r2',
          code: 'SR-OLDER222',
          type: 'custom',
          status: 'in_progress',
          itemId: 'i1',
          createdAt: '2026-10-01T00:00:00Z',
          typeFields: { stage: 'quoted', summary: 'Raking light', priceMinor: 1800, scope: 'Two photos' },
        },
      ],
    });
    const user = userEvent.setup();
    renderPage('#/shipping-services/requests');

    const table = await screen.findByRole('table', { name: 'Open requests' });
    expect(within(table).getByText('Waiting for your answer')).toBeInTheDocument();
    let rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('SR-NEWER111');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'needsYou');
    rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('SR-OLDER222');

    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'SN-CL10');
    expect(within(table).getAllByRole('row')).toHaveLength(2);

    await user.clear(screen.getByRole('searchbox', { name: 'Search requests' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'nothing like it');
    expect(await screen.findByText('No requests match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(screen.getByRole('table', { name: 'Open requests' })).toBeInTheDocument();
  });
});

describe('answering a quote', () => {
  const quoted = (type: 'buyout' | 'custom', typeFields: Record<string, unknown>) => ({
    id: `r-${type}`,
    code: type === 'buyout' ? 'SR-BUYOUT11' : 'SR-CUSTOM11',
    type,
    status: 'in_progress',
    itemId: 'i1',
    createdAt: '2026-11-01T00:00:00Z',
    typeFields: { stage: 'quoted', ...typeFields },
  });

  it('asks before selling a card to Card Embassy, naming the card and the amount, and names the amount on the button', async () => {
    serve({ '/vault/items': [ITEM], '/services/mine': [quoted('buyout', { offerMinor: 27_500 })] });
    post.mockResolvedValue({ creditedMinor: 27_500 });
    const user = userEvent.setup();
    renderPage('#/shipping-services/requests');

    await user.click(await screen.findByRole('button', { name: 'Accept $275.00' }));
    const dialog = screen.getByRole('dialog', { name: 'Sell this item for $275.00?' });
    expect(dialog).toHaveTextContent('SN-CL10-0005');
    expect(dialog).toHaveTextContent('cannot be undone');
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Accept $275.00' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept $275.00' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/services/buyout/r-buyout/accept'));
  });

  it('asks before a custom quote charges the wallet', async () => {
    serve({ '/vault/items': [ITEM], '/services/mine': [quoted('custom', { priceMinor: 1_800, summary: 'Raking light' })] });
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage('#/shipping-services/requests');

    await user.click(await screen.findByRole('button', { name: 'Accept $18.00' }));
    const dialog = screen.getByRole('dialog', { name: 'Pay $18.00 for this request?' });
    expect(dialog).toHaveTextContent('taken from your wallet');
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Accept $18.00' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/services/custom/r-custom/accept-quote'));
  });
});

describe('tracking', () => {
  it('shows no search on an empty list and offers to create a shipment', async () => {
    serve({ '/vault/items': [ITEM], '/services/mine': [], '/shipping/shipments': [] });
    const user = userEvent.setup();
    renderPage('#/shipping-services/tracking');

    expect(await screen.findByText('No shipments yet')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create a shipment' }));
    await waitFor(() => expect(window.location.hash).toContain('shipping-services/shipping'));
  });

  it('finds a shipment by the status as it is written, and puts the one waiting for payment first when asked', async () => {
    serve({ '/vault/items': [], '/services/mine': [], '/shipping/shipments': [SHIPMENT, OLDER_UNPAID] });
    const user = userEvent.setup();
    renderPage('#/shipping-services/tracking');

    const table = await screen.findByRole('table', { name: 'Shipment tracking' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('SHP-AAAA1111');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'needsYou');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('SHP-BBBB2222');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Waiting for your answer');

    await user.type(screen.getByRole('searchbox', { name: 'Search shipments' }), 'awaiting payment');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('says the shipments could not be loaded rather than that there are none', async () => {
    serve({ '/vault/items': [], '/services/mine': [], '/shipping/shipments': () => Promise.reject(new Error('Gateway timeout')) });
    renderPage('#/shipping-services/tracking');

    expect(await screen.findByText('Your shipments could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No shipments yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so when a link names a shipment that is not in the list', async () => {
    serve({ '/vault/items': [], '/services/mine': [], '/shipping/shipments': [SHIPMENT] });
    renderPage('#/shipping-services/tracking?shipment=gone');

    expect(await screen.findByText('That shipment is not among yours any more. Pick one from the list.')).toBeInTheDocument();
  });

  it('takes one Tab stop per row, on its Details button', async () => {
    serve({ '/vault/items': [], '/services/mine': [], '/shipping/shipments': [SHIPMENT] });
    renderPage('#/shipping-services/tracking');

    const table = await screen.findByRole('table', { name: 'Shipment tracking' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).not.toHaveAttribute('tabindex');
    expect(within(row).getByRole('button', { name: /SHP-AAAA1111/ })).toBeInTheDocument();
  });
});

describe('the shipment drawer', () => {
  function Drawer({ shipment, onStatus = () => {} }: { shipment: unknown; onStatus?: (m: string | null) => void }) {
    const { t } = useI18n();
    return (
      <ShipmentDrawer shipment={shipment as never} locale="en" t={t} onClose={() => {}} onChanged={() => {}} onStatus={onStatus} />
    );
  }

  it('says what happens next and lists what is in the parcel', async () => {
    serve({});
    render(
      <I18nProvider>
        <Drawer shipment={SHIPMENT} />
      </I18nProvider>,
    );
    expect(await screen.findByText(/With the carrier\. Follow it with the tracking number/)).toBeInTheDocument();
    expect(screen.getByText('What is in it')).toBeInTheDocument();
    expect(screen.getAllByText('SN-CL10-0005').length).toBeGreaterThan(0);
  });

  it('shows a failed payment inside the drawer, where the collector is looking', async () => {
    serve({});
    post.mockRejectedValue(new Error('Your wallet is still $12.00 short.'));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Drawer shipment={OLDER_UNPAID} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Pay now' }));
    const drawer = screen.getByRole('dialog');
    expect(await within(drawer).findByText('Your wallet is still $12.00 short.')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Cash in to your wallet' })).not.toBeInTheDocument();
  });

  it('links the tracking number to the carrier\'s own tracking page, in a new tab', async () => {
    serve({});
    render(
      <I18nProvider>
        <Drawer shipment={{ ...SHIPMENT, carrier: 'UPS', trackingNumber: '1Z 999' }} />
      </I18nProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Follow it on the UPS site' });
    expect(link).toHaveAttribute('href', 'https://www.ups.com/track?tracknum=1Z%20999');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers no link for a carrier it has no tracking page for', async () => {
    serve({});
    render(
      <I18nProvider>
        <Drawer shipment={{ ...SHIPMENT, carrier: 'Postal service', trackingNumber: 'RR123' }} />
      </I18nProvider>,
    );
    expect(await screen.findByText('RR123')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Follow it on/ })).toBeNull();
  });

  it('offers a way to the wallet next to a shortfall', async () => {
    serve({});
    post.mockRejectedValue(Object.assign(new Error('Short by $12.00. Cash in to your wallet and try again.'), { code: 'insufficient_balance' }));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <Drawer shipment={OLDER_UNPAID} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Pay now' }));
    const drawer = screen.getByRole('dialog');
    await user.click(await within(drawer).findByRole('button', { name: 'Cash in to your wallet' }));
    expect(window.location.hash).toBe('#/wallet/cash-in');
  });
});

describe('the page', () => {
  it('counts the shipments being packed or on the way on the overview', async () => {
    serve({ '/vault/items': [], '/services/mine': [], '/shipping/shipments': [SHIPMENT, OLDER_UNPAID, { ...SHIPMENT, id: 's3', status: 'delivered' }] });
    renderPage('#/shipping-services');
    await waitFor(() => expect(screen.getByText('Being packed or on the way').previousElementSibling).toHaveTextContent('2'));
  });

  it('shows one way of handing over at a time on In person', async () => {
    serve({ '/vault/items': [ITEM], '/services/mine': [], '/shipping/pickup/shows': [], '/shipping/white-glove/terms': null });
    const user = userEvent.setup();
    renderPage('#/shipping-services/in-person');

    expect(await screen.findByRole('heading', { name: 'Collect at a show' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Hand delivery' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collect at a show' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hand delivery' }));
    expect(await screen.findByRole('heading', { name: 'Hand delivery' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collect at a show' })).not.toBeInTheDocument();
    expect(screen.getByText('Tick the items to hand-deliver, then ask.')).toBeInTheDocument();
  });
});

describe('collecting at a show', () => {
  const SHOW = {
    id: 'e1',
    name: 'Philly Show',
    startsAt: '2026-12-21T10:00:00Z',
    requestDeadline: '2026-12-14T10:00:00Z',
    venue: 'Expo Center',
    city: 'Oaks, PA',
    feeMinor: 1500,
    remaining: 12,
    open: true,
  };

  it('says the shows could not be loaded, with a retry, instead of saying no show takes pickups', async () => {
    let fail = true;
    serve({
      '/shipping/shipments': [],
      '/shipping/pickup/shows': () => (fail ? Promise.reject(new Error('Down')) : Promise.resolve([SHOW])),
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ShowPickupPanel items={[ITEM]} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />
      </I18nProvider>,
    );
    expect(await screen.findByText('The shows could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No shows take pickups')).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Tick the items to bring, then book.')).toBeInTheDocument();
  });

  it('says where to follow the pickup once it is booked', async () => {
    serve({ '/shipping/shipments': [], '/shipping/pickup/shows': [SHOW] });
    post.mockResolvedValue({ id: 'p1', code: 'SHP-PICK0001' });
    const onStatus = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ShowPickupPanel items={[ITEM]} onError={() => {}} onStatus={onStatus} onCreated={() => {}} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Book the pickup' }));
    await waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith(
        'Pickup SHP-PICK0001 booked for Philly Show. Bring ID to the Card Embassy table; the booking is under Tracking.',
      ),
    );
  });
});

describe('shared parcels', () => {
  const GROUP = {
    id: 'g1',
    code: 'GRP-ABCD1234',
    status: 'forming',
    destinationAddress: '1 Show Hall',
    recipientName: 'Golden Marsh',
    notes: null,
    memberCount: 2,
    totalItems: 2,
    totalWeightGrams: 40,
    members: [
      { shipmentId: 'mine', shipmentCode: 'SHP-MINE0001', username: 'red', itemCount: 1, isPayer: false, status: 'requested' },
      { shipmentId: 'theirs', shipmentCode: null, username: 'golden', itemCount: 1, isPayer: true, status: 'requested' },
    ],
  };

  function renderTab() {
    return render(
      <I18nProvider>
        <SharedParcelsTab reloadToken={0} onChanged={() => {}} onError={() => {}} onStatus={() => {}} />
      </I18nProvider>,
    );
  }

  it('lists the collector’s own parcels first, and leads to Shipping rather than an empty form when no request is free', async () => {
    serve({ '/shipping/groups': [], '/shipping/shipments': [] });
    renderTab();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('My shared parcels');
    expect(await screen.findByRole('button', { name: 'Go to Shipping' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Join an existing parcel' })).not.toBeInTheDocument();
  });

  it('gives the close and cancel buttons only to the payer', async () => {
    serve({ '/shipping/groups': [GROUP], '/shipping/shipments': [{ ...SHIPMENT, id: 'mine', status: 'requested', groupId: 'g1' }] });
    renderTab();
    expect(await screen.findByText('Only the payer can lock or cancel it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close to new members' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel the parcel' })).not.toBeInTheDocument();
  });

  it('asks before the payer cancels the parcel', async () => {
    const payer = {
      ...GROUP,
      members: GROUP.members.map((m) => ({ ...m, isPayer: m.shipmentId === 'mine' })),
    };
    serve({ '/shipping/groups': [payer], '/shipping/shipments': [{ ...SHIPMENT, id: 'mine', status: 'requested', groupId: 'g1' }] });
    post.mockResolvedValue({ status: 'cancelled' });
    const user = userEvent.setup();
    renderTab();
    await user.click(await screen.findByRole('button', { name: 'Cancel the parcel' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel this shared parcel? Every request in it is kept, on its own.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel the parcel' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/shipping/groups/g1/cancel', expect.anything()));
  });

  it('says the parcels could not be loaded, with a retry', async () => {
    serve({ '/shipping/groups': () => Promise.reject(new Error('Down')), '/shipping/shipments': [] });
    renderTab();
    expect(await screen.findByText('Your shared parcels could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No shared parcels')).not.toBeInTheDocument();
  });
});

describe('the shipment composer', () => {
  it('moves focus to the heading of the step it opens', async () => {
    serve({
      '/shipping/countries': [{ code: 'US', name: 'United States', domestic: true, regionRequired: false, regions: [] }],
      '/shipping/services': { services: [], addOns: [], boxes: [], maxInsuredValueMinor: 500_000, signatureRequiredAboveMinor: 50_000, paymentWindowDays: 7 },
      '/me/addresses': [{ id: 'a1', label: 'Home', recipient: 'Red', line1: '1 Vine', city: 'Trenton', region: 'NJ', country: 'US', postalCode: '08608', isDefault: true }],
      '/shipping/shipments': [],
      '/finance/wallet': { amount: 0 },
    });
    post.mockResolvedValue({ rates: [], optionProblems: [], destination: { country: 'US' }, itemCount: 1, totalWeightGrams: 5 });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ShipmentComposer items={[ITEM]} onCreated={() => {}} />
      </I18nProvider>,
    );
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Where/ })).toHaveFocus());
  });

  it('says the addresses could not be loaded and loads them again on request', async () => {
    let fail = true;
    serve({
      '/shipping/countries': [],
      '/shipping/services': () => (fail ? Promise.reject(new Error('Down')) : Promise.resolve({ services: [], addOns: [], boxes: [], maxInsuredValueMinor: 1, signatureRequiredAboveMinor: 1, paymentWindowDays: 7 })),
      '/me/addresses': [],
      '/shipping/shipments': [],
    });
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ShipmentComposer items={[ITEM]} onCreated={() => {}} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Your addresses and the carrier list could not be loaded.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Your addresses and the carrier list could not be loaded.')).not.toBeInTheDocument());
  });
});

describe('every success says what comes next', () => {
  it('points each service request to where it is followed', () => {
    const en = MESSAGES.en;
    for (const key of [
      'services.photographyRequested',
      'services.gradingRequested',
      'services.videoRequested',
      'services.inspectionRequested',
      'services.lotSplitRequested',
      'services.deslabRequested',
      'services.consignmentRequested',
      'services.buyoutRequested',
    ] as const) {
      expect(en[key]).toMatch(/Shipping & Services, Service requests/);
    }
    expect(en['services.donated']).toMatch(/History/);
    expect(en['grp.opened']).toMatch(/Give its code/);
    expect(en['ship.done.bookedNext']).toMatch(/Tracking/);
  });
});
