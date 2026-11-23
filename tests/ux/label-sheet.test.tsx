import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { LabelSheet, LabelSheetButton, labelPdfUrls } = await import(
  '../../apps/web/src/areas/warehouse/LabelSheet'
);
const { IntakeBench } = await import('../../apps/web/src/areas/warehouse/IntakeBench');
const { ShelfContents } = await import('../../apps/web/src/areas/warehouse/ShelfContents');
const { ParcelQueue } = await import('../../apps/web/src/areas/warehouse/ParcelQueue');
const { ReceiveParcels } = await import('../../apps/web/src/areas/warehouse/ReceiveParcels');
const { RelocateBench, HoldBench, FulfillmentBench } = await import(
  '../../apps/web/src/areas/warehouse/Benches'
);
const { HouseOrdersPanel } = await import('../../apps/web/src/areas/warehouse/HouseOrdersPanel');

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

const SUGGESTION = { id: 'b1', serialNumber: 'BIN-QJLTDJH4', barcode: 'BIN-QJLTDJH4', zone: 'A', itemCount: 3, facilityCode: 'NJ' };
const FACILITIES = [{ facilityId: 'f1', code: 'NJ', name: 'Bault New Jersey', role: 'primary' }];
const PARCEL = {
  id: 'p1',
  code: 'PKG-AAAA1111',
  status: 'received',
  addressedTo: 'red',
  ownerUsername: 'red',
  facilityName: 'Bault New Jersey',
  facilityRole: 'primary',
  facilityCode: 'NJ',
  forwardedAt: null,
  receivedAt: '2026-09-01T10:00:00.000Z',
  trackingNumber: 'TRACK-1',
  itemCount: 0,
  internationalOrigin: false,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  get.mockImplementation((path: string) => {
    if (path.startsWith('/custody/bins/suggest')) return Promise.resolve(SUGGESTION);
    if (path === '/me/inbound-addresses') return Promise.resolve(FACILITIES);
    if (path === '/parcels') return Promise.resolve([PARCEL]);
    return Promise.resolve([]);
  });
});

const fast = () => userEvent.setup({ delay: null });

describe('the print sheet', () => {
  it('opens one item label, a batch, or a parcel label as a PDF at 100 percent', () => {
    expect(labelPdfUrls({ kind: 'items', items: [{ id: 'i-1', code: 'SN-A' }] })).toEqual([
      '/api/v1/custody/items/i-1/label.pdf#zoom=100',
    ]);
    expect(
      labelPdfUrls({
        kind: 'items',
        items: [
          { id: 'i-1', code: 'SN-A' },
          { id: 'i-2', code: 'SN-B' },
          { id: 'i-3', code: 'SN-C' },
        ],
      }),
    ).toEqual(['/api/v1/custody/labels.pdf?ids=i-1,i-2,i-3#zoom=100']);
    expect(labelPdfUrls({ kind: 'parcel', id: 'p-1', code: 'PKG-A' })).toEqual([
      '/api/v1/parcels/p-1/label.pdf#zoom=100',
    ]);
    expect(labelPdfUrls({ kind: 'items', items: [] })).toEqual([]);
  });

  it('splits a shelf of more than a hundred into PDFs of a hundred, the most one batch prints', () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ id: `i${i}`, code: `SN-${i}` }));
    const urls = labelPdfUrls({ kind: 'items', items });
    expect(urls).toHaveLength(2);
    expect(urls[0]!.split('ids=')[1]!.split('#')[0]!.split(',')).toHaveLength(100);
    expect(urls[1]!.split('ids=')[1]!.split('#')[0]!.split(',')).toHaveLength(50);
  });

  it('says the label size and how to set the printer: 50 x 25 mm, 100 percent, no fit to page', () => {
    wrap(
      <LabelSheet
        targets={{
          kind: 'items',
          items: [
            { id: 'i-1', code: 'SN-A' },
            { id: 'i-2', code: 'SN-B' },
          ],
        }}
      />,
    );
    const link = screen.getByRole('link', { name: /open the label pdf/i });
    expect(link).toHaveAttribute('href', '/api/v1/custody/labels.pdf?ids=i-1,i-2#zoom=100');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    const sheet = link.closest('section')!;
    expect(sheet).toHaveTextContent(/50 × 25 mm/);
    expect(sheet).toHaveTextContent(/203 dpi/);
    expect(sheet).toHaveTextContent(/Scale: 100 %/);
    expect(sheet).toHaveTextContent(/Fit to page/);
    expect(sheet).toHaveTextContent(/Zebra/);
    expect(within(sheet).getByText('SN-A')).toBeInTheDocument();
    expect(within(sheet).getByText('SN-B')).toBeInTheDocument();
  });

  it('opens from a button in a drawer', async () => {
    const user = fast();
    wrap(<LabelSheetButton targets={{ kind: 'parcel', id: 'p-1', code: 'PKG-A' }} />);
    await user.click(screen.getByRole('button', { name: /print the label for PKG-A/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /open the label pdf/i })).toHaveAttribute(
      'href',
      '/api/v1/parcels/p-1/label.pdf#zoom=100',
    );
  });
});

describe('where the print sheet is', () => {
  it('follows a booking-in on the intake bench, with every label just made in one PDF', async () => {
    const user = fast();
    post.mockResolvedValue([
      { id: 'i-1', barcode: 'SN-AAA-0001' },
      { id: 'i-2', barcode: 'SN-AAA-0002' },
    ]);
    wrap(<IntakeBench initialParcelId="" onLog={() => {}} onDone={async () => {}} onParcelClosed={() => {}} />);
    await user.type(screen.getByLabelText(/owner username/i), 'red');
    await user.type(screen.getAllByLabelText(/description/i)[0]!, 'A card');
    await waitFor(() => expect(screen.getByRole('button', { name: /^intake$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^intake$/i }));

    const link = await screen.findByRole('link', { name: /open the label pdf/i });
    expect(link).toHaveAttribute('href', '/api/v1/custody/labels.pdf?ids=i-1,i-2#zoom=100');
  });

  it('is at the foot of a shelf, with the labels for everything on it', async () => {
    get.mockImplementation(() =>
      Promise.resolve({
        bin: { id: 'b1', barcode: 'BIN-AAAA1111', zone: 'A', oversized: false, active: true },
        items: [
          { id: 'i1', serialNumber: 'SN-CL10-0005', barcode: 'SN-CL10-0005', typeClass: 'trading_card', description: 'Card', conditionGrade: null, lifecycleState: 'stored', holdFlag: false },
          { id: 'i2', serialNumber: 'SN-DX107-0003', barcode: 'SN-DX107-0003', typeClass: 'trading_card', description: 'Card', conditionGrade: null, lifecycleState: 'stored', holdFlag: false },
        ],
      }),
    );
    wrap(
      <ShelfContents
        bin={{ id: 'b1', barcode: 'BIN-AAAA1111', zone: 'A', oversized: false, active: true, itemCount: 2 }}
        onClose={() => {}}
      />,
    );
    const link = await screen.findByRole('link', { name: /open the label pdf/i });
    expect(link).toHaveAttribute('href', '/api/v1/custody/labels.pdf?ids=i1,i2#zoom=100');
  });

  it('is on every row of the parcel queue', async () => {
    const user = fast();
    wrap(<ParcelQueue />);
    const row = (await screen.findByText('PKG-AAAA1111')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /print the label for PKG-AAAA1111/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /open the label pdf/i })).toHaveAttribute(
      'href',
      '/api/v1/parcels/p1/label.pdf#zoom=100',
    );
  });
});

describe('a keyboard-wedge scanner: a fast burst of characters and Enter', () => {
  it('books in from the stow scan field', async () => {
    const user = fast();
    post.mockResolvedValue([{ id: 'i-1', barcode: 'SN-AAA-0001' }]);
    wrap(<IntakeBench initialParcelId="" onLog={() => {}} onDone={async () => {}} onParcelClosed={() => {}} />);
    await user.type(screen.getByLabelText(/owner username/i), 'red');
    await user.type(screen.getAllByLabelText(/description/i)[0]!, 'A card');
    await user.selectOptions(
      screen.getAllByRole('combobox').find((c) => within(c).queryByRole('option', { name: /scan/i }))!,
      'scan',
    );
    await user.type(await screen.findByPlaceholderText('BIN-XXXXXXXX'), 'BIN-5LPJN5LR{Enter}');

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/intake/items/batch');
    expect((body as { units: { binId: string }[] }).units[0]!.binId).toBe('BIN-5LPJN5LR');
  });

  it('on a unit serial goes on to the next unit, and on the last one books in', async () => {
    const user = fast();
    post.mockResolvedValue([
      { id: 'i-1', barcode: 'SN-1' },
      { id: 'i-2', barcode: 'SN-2' },
    ]);
    wrap(<IntakeBench initialParcelId="" onLog={() => {}} onDone={async () => {}} onParcelClosed={() => {}} />);
    await user.type(screen.getByLabelText(/owner username/i), 'red');
    await user.click(screen.getByRole('button', { name: /another unit/i }));
    const serials = screen.getAllByLabelText(/serial number/i);
    expect(serials).toHaveLength(2);

    await user.type(serials[0]!, 'PSA-11111111{Enter}');
    expect(post).not.toHaveBeenCalled();
    expect(serials[1]).toHaveFocus();
    await user.keyboard('PSA-22222222{Enter}');

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const units = (post.mock.calls[0]![1] as { units: { serialNumber: string }[] }).units;
    expect(units.map((u) => u.serialNumber)).toEqual(['PSA-11111111', 'PSA-22222222']);
  });

  it('receives an arrival from its tracking number', async () => {
    const user = fast();
    post.mockResolvedValue([{ code: 'PKG-NEW00001', status: 'received' }]);
    wrap(<ReceiveParcels onReceived={async (fn) => void (await fn())} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/me/inbound-addresses'));
    await user.type(screen.getByLabelText(/tracking number/i), '1Z999AA10123456784{Enter}');

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/parcels/receive/batch');
    expect((body as { parcels: { trackingNumber: string }[] }).parcels[0]!.trackingNumber).toBe(
      '1Z999AA10123456784',
    );
  });

  it('moves an item: the item scan goes on to the shelf scan, and the shelf scan moves it', async () => {
    const user = fast();
    post.mockResolvedValue({ status: 'relocated' });
    wrap(<RelocateBench shelves={[]} onLog={() => {}} onDone={async () => {}} />);
    await user.type(screen.getByPlaceholderText('SN-…'), 'SN-AAA-0001{Enter}');
    expect(screen.getByPlaceholderText('BIN-XXXXXXXX')).toHaveFocus();
    await user.keyboard('BIN-5LPJN5LR{Enter}');
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/custody/items/SN-AAA-0001/relocate', { binId: 'BIN-5LPJN5LR' }),
    );
  });

  it('places a hold from the hold scan', async () => {
    const user = fast();
    post.mockResolvedValue({ changed: true });
    wrap(<HoldBench onLog={() => {}} onDone={async () => {}} />);
    await user.type(screen.getByPlaceholderText('SN-…'), 'SN-AAA-0001{Enter}');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/custody/items/SN-AAA-0001/hold'));
  });

  it('loads a shipment from the dispatch scan', async () => {
    const user = fast();
    get.mockImplementation(() => Promise.reject(new Error('No such shipment')));
    wrap(<FulfillmentBench onLog={() => {}} />);
    await user.type(screen.getByLabelText(/shipment/i), 'SHP-AAAA1111{Enter}');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/shipping/shipments/SHP-AAAA1111'),
    );
  });

  it('stows a store sale from its shelf scan', async () => {
    const user = fast();
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/admin/house') || path.includes('house')
          ? [
              {
                id: 'o1',
                code: 'ORD-AAAA1111',
                description: 'A sealed pack',
                serialNumber: 'SN-HSE-0001',
                barcode: 'SN-HSE-0001',
                buyerUsername: 'red',
                listingCode: 'HSE-AAAA1111',
                placedAt: '2026-09-01T10:00:00.000Z',
                photoRef: null,
              },
            ]
          : [],
      ),
    );
    post.mockResolvedValue({ serialNumber: 'SN-HSE-0001', binBarcode: 'BIN-5LPJN5LR' });
    wrap(<HouseOrdersPanel onLog={() => {}} />);
    const field = await screen.findByPlaceholderText('BIN-XXXXXXXX');
    await user.type(field, 'BIN-5LPJN5LR{Enter}');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(post.mock.calls[0])).toContain('BIN-5LPJN5LR');
  });
});
