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
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { WarehouseConsole } = await import('../../apps/web/src/areas/warehouse/WarehouseConsole');
const { ReceiveParcels } = await import('../../apps/web/src/areas/warehouse/ReceiveParcels');
const { FulfillmentBench, DisposalBench } = await import('../../apps/web/src/areas/warehouse/Benches');
const { LabelSheet } = await import('../../apps/web/src/areas/warehouse/LabelSheet');
const { OcrReview } = await import('../../apps/web/src/areas/warehouse/OcrReview');
const { GradingSubmissions } = await import('../../apps/web/src/areas/warehouse/GradingSubmissions');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const wrap = (ui: React.ReactNode) => <I18nProvider>{ui}</I18nProvider>;

const NJ = {
  code: 'NJ',
  name: 'Card Embassy New Jersey',
  role: 'primary',
  careOf: 'Card Embassy C/O hermon',
  lines: ['SET REAL ADDRESS — placeholder'],
  city: 'Newark',
  region: 'NJ',
  postalCode: '00000',
  country: 'US',
  salesTaxBps: 663,
  forwardingDays: null,
  placeholder: true,
};
const PA = {
  ...NJ,
  code: 'PA',
  name: 'Card Embassy Philadelphia',
  lines: ['500 Harbor Way'],
  city: 'Philadelphia',
  region: 'PA',
  postalCode: '19104',
  placeholder: false,
};

const parcel = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `PKG-${id.toUpperCase()}`,
  status: 'received',
  addressedTo: 'red',
  ownerUsername: 'red',
  facilityName: 'Card Embassy New Jersey',
  facilityRole: 'primary',
  facilityCode: 'NJ',
  forwardedAt: null,
  receivedAt: '2026-11-01T10:00:00.000Z',
  trackingNumber: `TRK-${id}`,
  itemCount: 0,
  internationalOrigin: false,
  ...extra,
});

const BINS = [
  { id: 'b1', serialNumber: 'BIN-AAAA0001', barcode: 'BIN-AAAA0001', zone: 'A', oversized: false, active: true, itemCount: 3, facilityId: 'f1', facilityCode: 'NJ' },
  { id: 'b2', serialNumber: 'BIN-BBBB0002', barcode: 'BIN-BBBB0002', zone: 'B', oversized: false, active: true, itemCount: 0, facilityId: 'f1', facilityCode: 'NJ' },
];

let table: Record<string, unknown>;
let failing: Set<string>;

function route(path: string) {
  if (path.startsWith('/custody/bins/suggest')) {
    return Promise.resolve({ id: 'b1', serialNumber: 'BIN-AAAA0001', zone: 'A', itemCount: 3, facilityCode: 'NJ' });
  }
  const key = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => path === k || path.startsWith(k + '?') || path.startsWith(k + '/'));
  if (key && failing.has(key)) return Promise.reject(new Error('The server did not answer.'));
  return Promise.resolve(key !== undefined ? table[key] : []);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  failing = new Set();
  table = {
    '/me/inbound-addresses': [NJ, PA],
    '/parcels': [parcel('a1'), parcel('b2', { code: 'PKG-ZED', trackingNumber: '1Z999', addressedTo: 'golden', ownerUsername: 'golden', receivedAt: '2026-11-03T10:00:00.000Z' })],
    '/custody/bins': BINS,
    '/custody/report': [{ key: 'b1', label: 'BIN-AAAA0001', count: 3 }, { key: null, label: null, count: 2 }],
    '/services/queue': [],
    '/parcels/workflow/status': { awaitingOpen: 1, awaitingProcessing: 0, oldestReceivedAt: null, oldestWaitingHours: 5 },
    '/intake/lots': [],
    '/marketplace/house/orders/queue': [],
    '/custody/to-shelve': [],
    '/support/queue': [],
    '/services/grading/submissions': [],
    '/shipping/shipments': [],
  };
  get.mockImplementation(route);
});

function renderConsole(hash: string) {
  window.location.hash = hash;
  return render(wrap(<WarehouseConsole />));
}

function panel(titlePattern: RegExp): HTMLElement {
  const heading = screen.getAllByRole('heading').find((h) => titlePattern.test(h.textContent ?? ''));
  if (!heading) throw new Error(`no panel titled ${titlePattern}`);
  return heading.closest('section') as HTMLElement;
}

describe('receiving at a building with no real address', () => {
  it('says so on the bench, in the list of buildings and on the docket, and gives the real address of one that has it', async () => {
    const user = userEvent.setup();
    const { container } = render(wrap(<ReceiveParcels onReceived={vi.fn().mockResolvedValue(undefined)} />));
    const select = await screen.findByLabelText('Facility');
    await waitFor(() => expect(select).toHaveValue('NJ'));
    expect(within(select).getByRole('option', { name: 'Card Embassy New Jersey (address not set)' })).toBeInTheDocument();
    expect(screen.getByText(/still has the stand-in address/)).toBeInTheDocument();
    expect(screen.getByText('No real street address is set for this building yet.')).toBeInTheDocument();
    expect(container.querySelector('.docket, .drawer-tag')).toHaveTextContent('Address not set');

    await user.selectOptions(select, 'PA');
    expect(screen.queryByText(/still has the stand-in address/)).toBeNull();
    expect(screen.getByText('Address: 500 Harbor Way, Philadelphia PA 19104, US')).toBeInTheDocument();
  });

  it('says why nothing can be received when the buildings did not load, with a retry', async () => {
    failing.add('/me/inbound-addresses');
    const user = userEvent.setup();
    render(wrap(<ReceiveParcels onReceived={vi.fn().mockResolvedValue(undefined)} />));
    await screen.findByText(/list of buildings could not be loaded/);
    failing.delete('/me/inbound-addresses');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByLabelText('Facility')).toHaveValue('NJ'));
    expect(screen.queryByText(/list of buildings could not be loaded/)).toBeNull();
  });

  it('says what is still needed while Receive parcel is greyed out', async () => {
    render(wrap(<ReceiveParcels onReceived={vi.fn().mockResolvedValue(undefined)} />));
    await waitFor(() => expect(screen.getByLabelText('Facility')).toHaveValue('NJ'));
    expect(screen.getByRole('button', { name: 'Receive parcel' })).toBeDisabled();
    expect(screen.getByText(/Still needed: something to trace it by/)).toBeInTheDocument();
  });
});

describe('the inbound parcels', () => {
  it('can be searched and sorted, and say how many are shown', async () => {
    const user = userEvent.setup();
    renderConsole('#/warehouse/receiving');
    const queue = await waitFor(() => panel(/inbound parcels/i));
    await within(queue).findByText('PKG-A1');
    const codes = () => within(queue).getAllByText(/^PKG-/).map((el) => el.textContent);
    expect(codes()).toEqual(['PKG-A1', 'PKG-ZED']);
    await user.selectOptions(within(queue).getByLabelText('Sort by'), 'newest');
    expect(codes()).toEqual(['PKG-ZED', 'PKG-A1']);

    await user.type(within(queue).getByLabelText('Search inbound parcels'), 'golden');
    expect(codes()).toEqual(['PKG-ZED']);
    expect(within(queue).getByRole('status')).toHaveTextContent('1 of 2 shown');
    await user.clear(within(queue).getByLabelText('Search inbound parcels'));
    await user.type(within(queue).getByLabelText('Search inbound parcels'), 'nobody');
    await user.click(within(queue).getByRole('button', { name: 'Clear the search' }));
    expect(codes()).toHaveLength(2);
  });

  it('name every cell for a phone, where the table becomes cards', async () => {
    renderConsole('#/warehouse/receiving');
    const queue = await waitFor(() => panel(/inbound parcels/i));
    const cell = (await within(queue).findByText('PKG-A1')).closest('td')!;
    expect(cell.closest('.dt-wrap')).toHaveClass('dt-wrap--stack');
    const row = cell.closest('tr')!;
    expect([...row.querySelectorAll('td')].every((td) => td.getAttribute('data-label'))).toBe(true);
  });

  it('offer a retry when they did not load, instead of saying there are none', async () => {
    failing.add('/parcels');
    const user = userEvent.setup();
    renderConsole('#/warehouse/receiving');
    const queue = await waitFor(() => panel(/inbound parcels/i));
    await within(queue).findByText('The inbound parcels could not be loaded');
    expect(within(queue).queryByText(/nothing waiting|no parcels/i)).toBeNull();
    failing.delete('/parcels');
    await user.click(within(queue).getByRole('button', { name: 'Try again' }));
    await within(queue).findByText('PKG-A1');
  });

  it('show a mistyped username at the field when a parcel is attributed', async () => {
    table['/parcels'] = [parcel('u1', { status: 'unclaimed', ownerUsername: null, addressedTo: 'r.ashwod' })];
    const user = userEvent.setup();
    renderConsole('#/warehouse/receiving');
    const queue = await waitFor(() => panel(/inbound parcels/i));
    await user.click(await within(queue).findByRole('button', { name: 'Attribute' }));
    const field = within(queue).getByLabelText('Whose account it is (username)');
    await user.type(field, 'bad name!');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(within(queue).getByRole('alert')).toHaveTextContent(/Not a valid username/);
  });

  it('say opening needs only what the check found, and what comes next once it is open', async () => {
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderConsole('#/warehouse/receiving');
    const queue = await waitFor(() => panel(/inbound parcels/i));
    const row = (await within(queue).findByText('PKG-A1')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Open and check' }));
    expect(within(row).getByText('Write what the check found to open it. Photos are optional.')).toBeInTheDocument();
    await user.type(within(row).getByLabelText('What you found'), 'Box fine');
    await user.click(within(row).getByRole('button', { name: 'Open and check' }));
    await within(queue).findByText(/Next: book what is inside on the Receive bench/);
  });
});

describe('the receive bench', () => {
  it('has a way to every part of the long receiving tab', async () => {
    renderConsole('#/warehouse/receiving');
    const nav = await screen.findByRole('navigation', { name: 'Jump to' });
    for (const name of ['Receive', 'Inbound parcels', 'Receive bench', 'Store sales']) {
      expect(within(nav).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('says what is missing while Intake is greyed out, and does not suggest a real serial', async () => {
    renderConsole('#/warehouse/receiving');
    const bench = await waitFor(() => panel(/receive bench/i));
    await within(bench).findByText(/Still needed: a valid owner username; at least one unit/);
    expect(within(bench).getByPlaceholderText('SN-…')).toBeInTheDocument();
  });

  it('asks before closing a parcel out, then says it is closed and what comes next', async () => {
    table['/parcels'] = [parcel('o1', { status: 'opened', itemCount: 2 })];
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderConsole('#/warehouse/receiving');
    const bench = await waitFor(() => panel(/receive bench/i));
    await user.selectOptions(await within(bench).findByRole('combobox', { name: /from parcel/i }), 'o1');
    await user.click(within(bench).getByRole('button', { name: 'Close out parcel' }));
    expect(post).not.toHaveBeenCalled();
    expect(within(bench).getByText(/Close parcel PKG-O1 with 2 booked in\?/)).toBeInTheDocument();
    await user.click(within(bench).getByRole('button', { name: 'Keep it open' }));
    await user.click(within(bench).getByRole('button', { name: 'Close out parcel' }));
    await user.click(within(bench).getByRole('button', { name: 'Yes, close it out' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/parcels/o1/process', { emptyReason: undefined }));
    await within(bench).findByText(/Parcel PKG-O1 is closed out and charged/);
  });
});

describe('the service queue', () => {
  const BUYOUT = {
    id: 'sr-b',
    code: 'SR-BUY1',
    type: 'buyout',
    status: 'in_progress',
    itemId: 'i1',
    requesterEmail: 'red@bault.dev',
    itemDescription: 'Rayquaza',
    typeFields: {},
  };
  const CUSTOM = { ...BUYOUT, id: 'sr-c', code: 'SR-CUS1', type: 'custom', typeFields: { summary: 'Photo', detail: 'Back' } };
  const ASKED = { ...BUYOUT, id: 'sr-r', code: 'SR-ASK1', type: 'deslab', status: 'requested' };

  it('starts every money field empty, so no amount is quoted by accident, and reads back what was typed', async () => {
    table['/services/queue'] = [BUYOUT];
    const user = userEvent.setup();
    renderConsole('#/warehouse/services');
    const field = await screen.findByLabelText(/Quote amount/);
    expect(field).toHaveValue('');
    await user.type(field, '1250');
    expect(screen.getByText('$1,250.00')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'lots');
    expect(screen.getByText(/Not an amount/)).toBeInTheDocument();
  });

  it('does not ask a custom quote to confirm a verification it has no box for', async () => {
    table['/services/queue'] = [CUSTOM];
    renderConsole('#/warehouse/services');
    await screen.findByText('Fill every field.');
    expect(screen.queryByText(/confirm the item was verified/)).toBeNull();
  });

  it('asks before declining, and declines only on the second press', async () => {
    table['/services/queue'] = [ASKED];
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderConsole('#/warehouse/services');
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Decline SR-ASK1\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    await user.click(screen.getByRole('button', { name: 'Yes, decline' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/services/requests/sr-r/deny'));
  });

  it('names the customer by username, with the email under it', async () => {
    table['/services/queue'] = [{ ...BUYOUT, requesterUsername: 'red' }];
    renderConsole('#/warehouse/services');
    const cell = (await screen.findByText('@red')).closest('td')!;
    expect(cell).toHaveTextContent('red@bault.dev');
  });

  it('can be searched and filtered by status', async () => {
    table['/services/queue'] = [BUYOUT, ASKED];
    const user = userEvent.setup();
    renderConsole('#/warehouse/services');
    await screen.findByText('SR-BUY1');
    await user.selectOptions(screen.getByLabelText('Show'), 'requested');
    expect(screen.queryByText('SR-BUY1')).toBeNull();
    expect(screen.getByText('SR-ASK1')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await user.type(screen.getByLabelText('Search service requests'), 'buy1');
    expect(screen.queryByText('SR-ASK1')).toBeNull();
  });
});

describe('packing a shipment', () => {
  const READY = {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SHP-READY001',
    status: 'rates_selected',
    username: 'red',
    fulfilmentMethod: 'carrier',
    carrier: 'USPS',
    itemIds: ['i1'],
    rush: true,
  };
  const DONE = { ...READY, id: '22222222-2222-4222-8222-222222222222', code: 'SHP-GONE0001', status: 'shipped' };

  it('lists what is waiting to be packed, and loads one by its button or by its code', async () => {
    table['/shipping/shipments'] = [READY, DONE];
    table[`/shipping/shipments/${READY.id}`] = {
      id: READY.id,
      code: READY.code,
      status: 'rates_selected',
      carrier: 'USPS',
      serviceKey: 'usps_ground',
      itemIds: ['i1'],
      items: [{ id: 'i1', serialNumber: 'SN-ONE-0001', barcode: 'SN-ONE-0001', description: 'Card one' }],
      directParcel: null,
      destinationAddress: '12 Vine St',
      boxSize: null,
    };
    const user = userEvent.setup();
    render(wrap(<FulfillmentBench onLog={vi.fn()} />));
    await screen.findByText('Waiting to be packed (1)');
    expect(screen.queryByText('SHP-GONE0001')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pack SHP-READY001' }));
    await screen.findByLabelText(/scan each item/i);
    expect(screen.getByLabelText('Shipment ID')).toHaveValue('SHP-READY001');
    expect(screen.getByLabelText('Package weight (grams)')).toHaveValue(null);
    expect(screen.getByText(/Still needed: every item scanned/)).toBeInTheDocument();
  });

  it('says a code that is not waiting is not found, rather than that it is malformed', async () => {
    get.mockImplementation((path: string) =>
      path === '/shipping/shipments' ? Promise.resolve([]) : Promise.reject(new Error('That identifier is not in a valid format.')),
    );
    const user = userEvent.setup();
    render(wrap(<FulfillmentBench onLog={vi.fn()} />));
    await screen.findByText('Nothing is waiting to be packed');
    await user.type(screen.getByLabelText('Shipment ID'), 'SHP-NOPE{Enter}');
    await screen.findByText(/No shipment waiting to be packed has the code SHP-NOPE/);
  });
});

describe('the lots, the shelves and the log', () => {
  it('asks before a lot is broken, and says a failed load instead of claiming there are none', async () => {
    failing.add('/intake/lots');
    const user = userEvent.setup();
    renderConsole('#/warehouse/inventory');
    const lots = await waitFor(() => panel(/open lots/i));
    await within(lots).findByText('The open lots could not be loaded');
    expect(within(lots).queryByText('No whole lots to break.')).toBeNull();

    failing.delete('/intake/lots');
    table['/intake/lots'] = [{ id: 'l1', serialNumber: 'SN-LOT-0001', barcode: 'SN-LOT-0001', typeClass: 'trading_card', description: 'Bulk', lotSize: 40 }];
    post.mockResolvedValue({ producedCount: 40 });
    await user.click(within(lots).getByRole('button', { name: 'Try again' }));
    await user.click(await within(lots).findByRole('button', { name: /break/i }));
    expect(post).not.toHaveBeenCalled();
    expect(within(lots).getByText(/Break SN-LOT-0001 into 40 items\? This cannot be undone\./)).toBeInTheDocument();
    await user.click(within(lots).getByRole('button', { name: 'Yes, break it' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/intake/items/l1/break-lot'));
  });

  it('finds a shelf by search, and says what changed when one is taken out of service, with the log on that tab', async () => {
    patch.mockResolvedValue({});
    const user = userEvent.setup();
    renderConsole('#/warehouse/locations');
    await screen.findAllByText('BIN-AAAA0001');
    await user.type(screen.getByLabelText('Search shelves'), 'BBBB');
    expect(screen.queryAllByText('BIN-AAAA0001')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Take BIN-BBBB0002 out of service' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/custody/bins/b2', { active: false }));
    expect(await screen.findAllByText('Shelf BIN-BBBB0002 taken out of service')).toHaveLength(2);
    expect(panel(/^Log$/)).toBeInTheDocument();
  });

  it('leads from the items on no shelf, and from the parcel backlog, to where they are worked', async () => {
    const user = userEvent.setup();
    renderConsole('#/warehouse/overview');
    expect(await screen.findByText('Oldest has waited 5h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view parcels/i })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '2 on no shelf: see them under To shelve' }));
    await waitFor(() => expect(window.location.hash).toContain('inventory'));
  });
});

describe('the support queue', () => {
  const ticket = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    code: `SUP-${id}`,
    subject: `Subject ${id}`,
    category: 'other',
    status: 'open',
    lastMessageAt: '2026-11-01T10:00:00.000Z',
    createdAt: '2026-11-01T10:00:00.000Z',
    assignedTo: null,
    customerUsername: 'red',
    customerStatus: 'active',
    relatedType: null,
    relatedId: null,
    ...extra,
  });

  it('shows the tickets nobody has taken, finds one by search, and says when one is taken', async () => {
    table['/support/queue'] = [ticket('T1'), ticket('T2', { assignedTo: 'u-x', customerUsername: 'golden' })];
    post.mockResolvedValue({});
    const user = userEvent.setup();
    renderConsole('#/warehouse/support');
    await screen.findByText('Subject T2');
    await user.selectOptions(screen.getByLabelText('Show'), 'unassigned');
    expect(screen.queryByText('Subject T2')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await user.type(screen.getByLabelText('Search tickets'), 'golden');
    expect(screen.queryByText('Subject T1')).toBeNull();
    await user.clear(screen.getByLabelText('Search tickets'));
    await user.click(screen.getByRole('button', { name: 'Take' }));
    await screen.findByText(/You took SUP-T1/);
  });
});

describe('the small benches', () => {
  it('shows a mistyped owner on the not-accepted form at its field, and lists what is still needed', async () => {
    const user = userEvent.setup();
    render(wrap(<DisposalBench onLog={vi.fn()} />));
    await user.type(screen.getByLabelText('Owner username'), 'no way!');
    expect(screen.getByRole('alert')).toHaveTextContent(/Not a valid username/);
    expect(screen.getByText(/Still needed: a valid owner username; what the item was; notes/)).toBeInTheDocument();
  });

  it('folds the printer instructions away under the button that opens the labels', () => {
    render(wrap(<LabelSheet targets={{ kind: 'items', items: [{ id: 'i-1', code: 'SN-A' }] }} />));
    const summary = screen.getByText('How to set the printer');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });
});

describe('a reading that did not come in time', () => {
  it('can be looked for again instead of ending the review', async () => {
    get.mockImplementation(() => Promise.resolve({ ready: false }));
    const user = userEvent.setup();
    render(wrap(<OcrReview subject="parcel" id="p1" pollMs={5} waitMs={10} />));
    await screen.findByText(/Nothing was read from the photo in time/);
    const before = get.mock.calls.length;
    get.mockImplementation(() =>
      Promise.resolve({ ready: true, fields: { trackingNumber: '1Z999' }, confidence: { trackingNumber: 0.9 } }),
    );
    await user.click(screen.getByRole('button', { name: 'Look for a reading again' }));
    await screen.findByDisplayValue('1Z999');
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('grading batches', () => {
  const OPEN = {
    id: 'g1',
    code: 'GS-0001',
    gradingBody: 'PSA',
    status: 'open',
    trackingNumber: null,
    externalReference: null,
    shippedAt: null,
    returnedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
  };
  const READY = {
    id: 'r1',
    code: 'SR-0001',
    itemId: 'i1',
    typeFields: { declaredMinor: 25_000 },
    requesterUsername: 'red',
    itemDescription: 'Rayquaza VMAX',
    serialNumber: 'SN-RAYQ-0001',
  };

  it('says what to do when there is no batch, and names the batch it opens', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ ...OPEN });
    render(wrap(<GradingSubmissions />));
    expect(await screen.findByText('No grading batches yet')).toBeInTheDocument();
    expect(screen.getByText(/Type the grader, for instance PSA, and press Open a batch/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open a batch' }));
    expect(
      await screen.findByText('Batch GS-0001 is open for PSA. Press Manage on it to add the approved requests waiting for PSA.'),
    ).toBeInTheDocument();
  });

  it('names what it adds and what it ships, says "1 item" for one, and shows a refusal beside the button', async () => {
    const user = userEvent.setup();
    table['/services/grading/submissions'] = [OPEN];
    table['/services/grading/submissions/ready'] = [READY];
    render(wrap(<GradingSubmissions />));
    await user.click(await screen.findByRole('button', { name: 'Manage batch GS-0001' }));
    expect(screen.getByText('$250.00', { exact: false })).toBeInTheDocument();

    post.mockResolvedValueOnce({});
    await user.click(await screen.findByRole('button', { name: 'Add SN-RAYQ-0001 to batch GS-0001' }));
    expect(await screen.findByText('SN-RAYQ-0001 is in batch GS-0001. Add any others, then ship the batch.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Tracking number'), '1Z1');
    await user.type(screen.getByLabelText('Notes'), 'One card');
    post.mockRejectedValueOnce(new Error('Nothing in this submission is waiting to be graded'));
    await user.click(screen.getByRole('button', { name: 'Ship' }));
    const refusal = await screen.findByText('Nothing in this submission is waiting to be graded');
    expect(refusal.closest('.stack-top')).toContainElement(screen.getByRole('button', { name: 'Ship' }));

    post.mockResolvedValueOnce({ status: 'shipped', itemCount: 1 });
    await user.click(screen.getByRole('button', { name: 'Ship' }));
    expect(
      await screen.findByText(
        'Batch GS-0001 is on its way to PSA with 1 item. When it comes back, record each grade in the service queue, then mark the batch returned.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 items/)).toBeNull();
  });

  it('names the batch it marks returned, and says how to get there', async () => {
    const user = userEvent.setup();
    table['/services/grading/submissions'] = [
      { ...OPEN, status: 'shipped', trackingNumber: '1Z1', shippedAt: '2026-11-02T10:00:00.000Z' },
    ];
    post.mockResolvedValue({ status: 'returned' });
    render(wrap(<GradingSubmissions />));
    expect(await screen.findByText(/Record the grade of every item in the batch in the service queue/)).toBeInTheDocument();
    expect(screen.getByText(/^shipped /)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark batch GS-0001 returned' }));
    expect(await screen.findByText('Batch GS-0001 is back from PSA and closed. Every item in it has its grade.')).toBeInTheDocument();
  });
});
