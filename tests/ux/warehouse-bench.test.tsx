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
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span data-testid="barcode">{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span data-testid="barcode-label">{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
  BarcodePrintAllButton: ({ labels }: { labels: readonly unknown[] }) =>
    labels.length > 0 ? <button type="button">Print all</button> : null,
  printBarcode: () => {},
  printBarcodes: () => {},
}));

const { WarehouseConsole } = await import('../../apps/web/src/areas/warehouse/WarehouseConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const BINS = [
  { id: 'bin-a', serialNumber: 'BIN-QJLTDJH4', barcode: 'BIN-QJLTDJH4', zone: 'A', oversized: false, active: true, itemCount: 12, facilityId: 'f1', facilityCode: 'NJ' },
  { id: 'bin-o', serialNumber: 'BIN-5LPJN5LR', barcode: 'BIN-5LPJN5LR', zone: 'O', oversized: true, active: true, itemCount: 1, facilityId: 'f1', facilityCode: 'NJ' },
];

const SUGGESTION = {
  id: 'bin-a',
  serialNumber: 'BIN-QJLTDJH4',
  barcode: 'BIN-QJLTDJH4',
  zone: 'A',
  itemCount: 12,
  facilityCode: 'NJ',
};

function apiFor(overrides: Record<string, unknown> = {}) {
  return (path: string) => {
    const table: Record<string, unknown> = {
      '/custody/bins': BINS,
      '/custody/report?cut=shelf': { rows: [{ key: 'bin-a', label: 'BIN-QJLTDJH4 (A)', count: 12 }] },
      '/services/queue': [],
      '/parcels/workflow/status': { awaitingOpen: 2, awaitingProcessing: 1, unclaimed: 0, oldestReceivedAt: null, oldestWaitingHours: 9 },
      '/parcels': [],
      '/intake/lots': [],
      '/me/inbound-addresses': [{ facilityId: 'f1', code: 'NJ', name: 'Bault New Jersey', role: 'primary' }],
      ...overrides,
    };
    const key = Object.keys(table).find((k) => path.startsWith(k.split('?')[0]!) && (k.includes('?') ? path === k : true));
    if (path.startsWith('/custody/bins/suggest')) return Promise.resolve(SUGGESTION);
    if (key !== undefined) return Promise.resolve(table[key]);
    return Promise.resolve([]);
  };
}

function renderConsole() {
  window.location.hash = '#/warehouse/receiving';
  return render(
    <I18nProvider>
      <WarehouseConsole />
    </I18nProvider>,
  );
}


function panel(titlePattern: RegExp, opts: { withTable?: boolean } = {}): HTMLElement {
  const sections = screen
    .getAllByRole('heading')
    .filter((h) => titlePattern.test(h.textContent ?? ''))
    .map((h) => h.closest('section.panel'))
    .filter((s): s is HTMLElement => s !== null);
  const match = opts.withTable ? sections.find((s) => s.querySelector('table')) : sections[0];
  if (!match) throw new Error(`no panel titled ${titlePattern}`);
  return match;
}

function selectWithOption(scope: HTMLElement, pattern: RegExp): HTMLSelectElement {
  const found = within(scope)
    .getAllByRole('combobox')
    .find((s) => Array.from(s.querySelectorAll('option')).some((o) => pattern.test(o.textContent ?? '')));
  if (!found) throw new Error(`no select offering ${pattern}`);
  return found as HTMLSelectElement;
}


function field(scope: HTMLElement, caption: string): HTMLElement {
  return within(scope).getByLabelText(caption, { exact: true });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockImplementation(apiFor());
});

describe('the directed stow', () => {
  it('tells the operator which shelf to walk to, by serial', async () => {
    renderConsole();

    await waitFor(() => expect(within(panel(/receive bench/i)).getByText('BIN-QJLTDJH4')).toBeInTheDocument());
    expect(within(panel(/receive bench/i)).getByText(/Zone A/)).toBeInTheDocument();

    const suggestCalls = get.mock.calls.filter((c) => String(c[0]).startsWith('/custody/bins/suggest'));
    expect(suggestCalls.length).toBeGreaterThan(0);
  });

  it('asks for oversized shelving when the class needs it', async () => {
    const user = userEvent.setup();
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));

    await user.selectOptions(selectWithOption(bench, /sealed case/i), 'sealed_case');

    await waitFor(() => {
      const asked = get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/custody/bins/suggest'));
      expect(asked.some((p) => p.includes('oversized=true'))).toBe(true);
    });
  });

  it('books the item in with autoStow, never with a hand-picked bin id', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue([{ id: 'i1', barcode: 'SN-ABC-1234' }]);
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));

    const owner = field(bench, 'Owner username') as HTMLInputElement;
    await user.clear(owner);
    await user.type(owner, 'red');
    await user.type(within(bench).getByLabelText(/description/i), 'A card');

    await user.click(within(bench).getByRole('button', { name: /^intake$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/intake/items/batch');
    const unit = (body as { units: Record<string, unknown>[] }).units[0]!;
    expect(unit.autoStow).toBe(true);
    expect(unit.binId).toBeUndefined();
    expect(unit.ownerUsername).toBe('red');
  });

  it('switches to a scanned shelf and sends that instead', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue([{ id: 'i2', barcode: 'SN-ABC-5678' }]);
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));

    await user.selectOptions(selectWithOption(bench, /wherever there is room/i), 'scan');

    const shelf = await within(bench).findByPlaceholderText('BIN-XXXXXXXX');
    await user.type(shelf, 'BIN-5LPJN5LR');

    const owner = field(bench, 'Owner username') as HTMLInputElement;
    await user.clear(owner);
    await user.type(owner, 'red');
    await user.type(within(bench).getByLabelText(/description/i), 'A card');

    await user.click(within(bench).getByRole('button', { name: /^intake$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const unit = (post.mock.calls[0]![1] as { units: Record<string, unknown>[] }).units[0]!;
    expect(unit.binId).toBe('BIN-5LPJN5LR');
    expect(unit.autoStow).toBe(false);
  });

  it('will not let an intake be submitted with nowhere to put it', async () => {
    const user = userEvent.setup();
    get.mockImplementation((path: string) => {
      if (path.startsWith('/custody/bins/suggest')) {
        return Promise.reject(new Error('No active bin is available here — create one before stowing this'));
      }
      return apiFor()(path);
    });

    renderConsole();

    expect(await screen.findByText(/no active bin is available/i)).toBeInTheDocument();
    const submit = within(panel(/receive bench/i)).getByRole('button', { name: /^intake$/i });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('the shelf list', () => {
  it('shows what is on each shelf and never a capacity', async () => {
    window.location.hash = '#/warehouse/locations';
    render(
      <I18nProvider>
        <WarehouseConsole />
      </I18nProvider>,
    );

    const table = await waitFor(() => panel(/^shelves$/i, { withTable: true }));
    expect(within(table).getAllByText('BIN-QJLTDJH4').length).toBeGreaterThan(0);
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).queryByText(/\d+\s*\/\s*\d+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^capacity$/i)).not.toBeInTheDocument();
  });

  it('distinguishes oversized shelving from standard', async () => {
    window.location.hash = '#/warehouse/locations';
    render(
      <I18nProvider>
        <WarehouseConsole />
      </I18nProvider>,
    );
    const table = await waitFor(() => panel(/^shelves$/i, { withTable: true }));
    expect(within(table).getAllByText(/oversized/i).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/standard/i).length).toBeGreaterThan(0);
  });
});

describe('packing a shipment', () => {
  const DETAIL = {
    id: 'shp-1',
    code: 'SHP-PACK0001',
    status: 'rates_selected',
    carrier: 'USPS',
    serviceKey: 'usps_ground',
    itemIds: ['i1', 'i2'],
    items: [
      { id: 'i1', serialNumber: 'SN-ONE-0001', barcode: 'SN-ONE-0001', description: 'Card one' },
      { id: 'i2', serialNumber: 'SN-TWO-0002', barcode: 'SN-TWO-0002', description: 'Card two' },
    ],
    directParcel: null,
    destinationAddress: 'Red Ashwood, 12 Vine St, Trenton, 08608, US',
    boxSize: null,
  };

  function renderShipments(detail: unknown) {
    get.mockImplementation((path: string) =>
      path === '/shipping/shipments/shp-1' ? Promise.resolve(detail) : apiFor()(path),
    );
    window.location.hash = '#/warehouse/shipments';
    return render(
      <I18nProvider>
        <WarehouseConsole />
      </I18nProvider>,
    );
  }

  async function load(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Shipment ID'), 'shp-1');
    await user.click(screen.getByRole('button', { name: 'Fulfill' }));
  }

  async function scan(user: ReturnType<typeof userEvent.setup>, label: RegExp, code: string) {
    const input = await screen.findByLabelText(label);
    await user.type(input, `${code}{Enter}`);
  }

  it('sends what was scanned, and only once every card is', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ status: 'shipped', trackingNumber: 'SBX-1' });
    renderShipments(DETAIL);
    await load(user);

    await user.type(await screen.findByLabelText('Notes'), 'Rigid mailer.');
    const complete = screen.getByRole('button', { name: 'Complete' });
    expect(complete).toBeDisabled();

    await scan(user, /scan each item/i, 'sn-one-0001');
    expect(complete).toBeDisabled();

    await scan(user, /scan each item/i, 'SN-NOPE-9999');
    expect(screen.getByText(/not in this shipment/i)).toBeInTheDocument();
    await scan(user, /scan each item/i, 'SN-TWO-0002');
    expect(complete).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /remove SN-NOPE-9999/i }));
    expect(complete).toBeEnabled();
    await user.click(complete);

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/shipping/shipments/shp-1/dispatch');
    expect(body).toMatchObject({ scannedItemIds: ['sn-one-0001', 'SN-TWO-0002'], carrier: 'USPS' });
    expect((body as { scannedItemIds: string[] }).scannedItemIds).not.toEqual(['i1', 'i2']);
  });

  it('closes a direct-overnight shipment by scanning its parcel', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ status: 'shipped', trackingNumber: 'SBX-2' });
    renderShipments({
      ...DETAIL,
      serviceKey: 'direct_overnight',
      itemIds: [],
      items: [],
      directParcel: { code: 'PKG-DIRECT01', trackingNumber: '1Z999AA10123456784' },
    });
    await load(user);
    await user.type(await screen.findByLabelText('Notes'), 'Overnight envelope.');
    const complete = screen.getByRole('button', { name: 'Complete' });

    await scan(user, /scan the parcel/i, 'PKG-SOMEONE-ELSE');
    expect(screen.getByText(/not this shipment.s parcel/i)).toBeInTheDocument();
    expect(complete).toBeDisabled();

    await scan(user, /scan the parcel/i, '1Z999AA10123456784');
    expect(complete).toBeEnabled();
    await user.click(complete);

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0]!;
    expect(body).toMatchObject({ scannedParcel: '1Z999AA10123456784' });
    expect(body).not.toHaveProperty('scannedItemIds');
  });
});

describe('the service queue', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    post.mockResolvedValue({});
  });

  it('lets the operator cancel and refund a request that is already under way', async () => {
    const DESLAB = {
      id: 'sr-1',
      code: 'SR-DESLAB1',
      type: 'deslab',
      status: 'in_progress',
      itemId: 'it-1',
      requesterEmail: 'red@bault.dev',
      itemDescription: 'Sold before the bench',
      typeFields: {},
    };
    get.mockImplementation(apiFor({ '/services/queue': [DESLAB] }));
    window.location.hash = '#/warehouse/services';
    render(
      <I18nProvider>
        <WarehouseConsole />
      </I18nProvider>,
    );
    const button = await screen.findByRole('button', { name: /cancel and refund/i });
    await userEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/services/requests/sr-1/deny'));
  });
});
