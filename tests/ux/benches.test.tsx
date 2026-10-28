import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

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
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
  BarcodePrintAllButton: () => <button type="button">Print all</button>,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { RelocateBench, HoldBench, DisposalBench, NewShelfBench, FulfillmentBench, shelfFor } =
  await import('../../apps/web/src/areas/warehouse/Benches');
const { ReceiveParcels } = await import('../../apps/web/src/areas/warehouse/ReceiveParcels');
const { HouseOrdersPanel } = await import('../../apps/web/src/areas/warehouse/HouseOrdersPanel');
const { WarehouseConsole } = await import('../../apps/web/src/areas/warehouse/WarehouseConsole');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The warehouse's benches: each is its fields and, beside them, a docket (the job in hand, written on paper as it is
 * scanned or typed, with how the last press of the button came out in its foot). A scanner ends with Enter, so the
 * first scan goes on to the next field and the last does the job.
 */
const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const CSS = [
  'index',
  'theme',
  'slab',
  'components',
  'buttons',
  'landing',
  'app',
  'gallery',
  'screens',
  'motion',
]
  .map((name) => readFileSync(join(SRC, `${name}.css`), 'utf8'))
  .join('\n');
const BROWSER = '/opt/pw-browsers/chromium';

let browser: Browser | null = null;
try {
  browser = await chromium.launch(
    existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' },
  );
} catch {
  browser = null;
}
afterAll(async () => {
  await browser?.close();
});

type Locale = 'en' | 'he';

async function inBrowser(
  width: number,
  locale: Locale,
  theme: 'dark' | 'light',
  touch = false,
): Promise<Page> {
  const html = document.body.innerHTML;
  const context = await browser!.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bault</title><style>${CSS}</style></head><body>${html}</body></html>`,
  );
  return page;
}

const SHELVES = [
  {
    id: 'b1',
    serialNumber: 'BIN-RF5DBQ7Q',
    barcode: 'BIN-RF5DBQ7Q',
    zone: 'A',
    oversized: false,
    active: true,
    itemCount: 1,
    facilityCode: 'NJ',
  },
  {
    id: 'b2',
    serialNumber: 'BIN-CMGKLAEP',
    barcode: 'BIN-CMGKLAEP',
    zone: 'O',
    oversized: true,
    active: false,
    itemCount: 0,
    facilityCode: 'NJ',
  },
];

const FACILITIES = [
  { facilityId: 'f1', code: 'NJ', name: 'Bault New Jersey', role: 'primary' },
  { facilityId: 'f2', code: 'TA', name: 'Bault Tel Aviv', role: 'primary' },
];

const wrap = (ui: React.ReactElement) => <I18nProvider>{ui}</I18nProvider>;
const docketOf = (container: HTMLElement) =>
  container.querySelector('.request-slip') as HTMLElement;
const lineOf = (docket: HTMLElement, label: string) =>
  within(docket).getByText(label, { selector: 'dt' }).closest('.ledger-line') as HTMLElement;
const outcomeOf = (docket: HTMLElement) => docket.querySelector('.docket-outcome') as HTMLElement;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  get.mockImplementation((path: string) => {
    if (path === '/me/inbound-addresses') return Promise.resolve(FACILITIES);
    return Promise.resolve([]);
  });
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '';
});

describe('which shelf was scanned', () => {
  it('is the shelf whose barcode, serial or number it is, whatever the case it was typed in', () => {
    expect(shelfFor(SHELVES, 'bin-rf5dbq7q')?.zone).toBe('A');
    expect(shelfFor(SHELVES, '  b2  ')?.serialNumber).toBe('BIN-CMGKLAEP');
    expect(shelfFor(SHELVES, 'BIN-NOPE')).toBeUndefined();
    expect(shelfFor(SHELVES, '')).toBeUndefined();
  });
});

describe('moving an item', () => {
  function open() {
    const onLog = vi.fn();
    const onDone = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(wrap(<RelocateBench shelves={SHELVES} onLog={onLog} onDone={onDone} />));
    return { user, onLog, onDone, ...view };
  }

  it('writes the item on the docket as it is scanned, and reads the shelf back before anything is moved', async () => {
    const { user, container } = open();
    const docket = docketOf(container);
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('Item');
    expect(docket.querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();
    expect(lineOf(docket, 'To shelf')).toHaveTextContent('—');

    await user.type(screen.getByLabelText('Scan item'), 'SN-CL10-0005');
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('SN-CL10-0005');

    await user.type(screen.getByLabelText('Scan shelf'), 'bin-rf5dbq7q');
    expect(within(lineOf(docket, 'To shelf')).getByText('BIN-RF5DBQ7Q')).toBeInTheDocument();
    expect(within(lineOf(docket, 'Zone')).getByText('A')).toBeInTheDocument();
    expect(within(lineOf(docket, 'Storage kind')).getByText('Standard')).toBeInTheDocument();
    expect(within(lineOf(docket, 'On it now')).getByText('1')).toBeInTheDocument();
  });

  it('says so, before the button is pressed, when the shelf is out of service', async () => {
    const { user, container } = open();
    await user.type(screen.getByLabelText('Scan shelf'), 'BIN-CMGKLAEP');
    expect(within(docketOf(container)).getByText('Out of service')).toBeInTheDocument();
  });

  it('takes a scanner’s Enter on to the shelf, and the next Enter does it: the docket says what was moved, and the first field is ready for the next', async () => {
    post.mockResolvedValue({});
    const { user, onLog, onDone, container } = open();
    await user.type(screen.getByLabelText('Scan item'), 'SN-CL10-0005{Enter}');
    expect(screen.getByLabelText('Scan shelf')).toHaveFocus();
    await user.type(screen.getByLabelText('Scan shelf'), 'BIN-RF5DBQ7Q{Enter}');

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/custody/items/SN-CL10-0005/relocate', {
        binId: 'BIN-RF5DBQ7Q',
      }),
    );
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('Moved'));
    expect(outcome).toHaveTextContent('SN-CL10-0005 → BIN-RF5DBQ7Q');
    expect(screen.getByLabelText('Scan item')).toHaveValue('');
    expect(screen.getByLabelText('Scan shelf')).toHaveValue('');
    expect(screen.getByLabelText('Scan item')).toHaveFocus();
    expect(onLog).toHaveBeenCalledWith('Moved SN-CL10-0005 to BIN-RF5DBQ7Q');
    expect(onDone).toHaveBeenCalled();
  });

  it('says why it was refused where the hands are (the log is on another tab), and keeps what was scanned', async () => {
    post.mockRejectedValue(new Error('That shelf is out of service.'));
    const { user, container } = open();
    await user.type(screen.getByLabelText('Scan item'), 'SN-CL10-0005');
    await user.type(screen.getByLabelText('Scan shelf'), 'BIN-CMGKLAEP');
    await user.click(screen.getByRole('button', { name: 'Relocate' }));
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('Not done'));
    expect(outcome).toHaveTextContent('That shelf is out of service.');
    expect(screen.getByLabelText('Scan item')).toHaveValue('SN-CL10-0005');
    // What the last press came to is announced to a screen reader, and it goes when something else is scanned.
    expect(outcome).toHaveAttribute('role', 'status');
    await user.type(screen.getByLabelText('Scan item'), '1');
    expect(outcome).not.toHaveTextContent('Not done');
  });
});

describe('putting an item on hold', () => {
  function open() {
    const user = userEvent.setup();
    const onLog = vi.fn();
    const view = render(
      wrap(<HoldBench onLog={onLog} onDone={vi.fn().mockResolvedValue(undefined)} />),
    );
    return { user, onLog, ...view };
  }

  it('places the hold on Enter, and the docket says it is on hold', async () => {
    post.mockResolvedValue({ changed: true });
    const { user, container } = open();
    await user.type(screen.getByLabelText('Scan the item'), 'SN-ONE-0001{Enter}');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/custody/items/SN-ONE-0001/hold'));
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('On hold'));
    expect(outcome).toHaveTextContent('SN-ONE-0001');
  });

  it('releases with the other button, and says when nothing changed, as a warning and not as a success', async () => {
    del.mockResolvedValue({ changed: false });
    const { user, container } = open();
    await user.type(screen.getByLabelText('Scan the item'), 'SN-ONE-0001');
    await user.click(screen.getByRole('button', { name: 'Release' }));
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('No change'));
    expect(outcome).toHaveTextContent('SN-ONE-0001 was not on hold — nothing changed.');
    expect(outcome.querySelector('.pill--warning')).not.toBeNull();
  });
});

describe('an arrival that was not accepted', () => {
  it('is the record as it will be kept, line by line as it is typed, and says when it is filed', async () => {
    post.mockResolvedValue({ code: 'DSP-0001' });
    const user = userEvent.setup();
    const onLog = vi.fn();
    const { container } = render(wrap(<DisposalBench onLog={onLog} />));
    const docket = docketOf(container);
    expect(lineOf(docket, 'Owner')).toHaveTextContent('—');
    expect(within(lineOf(docket, 'Reason')).getByText('GPS tracker')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Owner username'), 'red');
    await user.type(screen.getByLabelText('What the item was'), 'A box with a GPS tracker in it');
    await user.type(screen.getByLabelText('Notes (required)'), 'Found under the lining.');
    expect(within(lineOf(docket, 'Owner')).getByText('@red')).toBeInTheDocument();
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent(
      'A box with a GPS tracker in it',
    );
    expect(
      within(lineOf(docket, 'Notes')).getByText('Found under the lining.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record disposal' }));
    const outcome = outcomeOf(docket);
    await waitFor(() => expect(outcome).toHaveTextContent('Recorded'));
    expect(outcome).toHaveTextContent('DSP-0001 · @red');
    expect(onLog).toHaveBeenCalledWith('Recorded DSP-0001 for red');
  });
});

describe('a new shelf', () => {
  it('is its zone, its kind and where it stands, with its serial said to be minted, and it is created as the docket says', async () => {
    post.mockResolvedValue({ serialNumber: 'BIN-NEW00001', zone: 'C-3' });
    const user = userEvent.setup();
    const onCreated = vi.fn().mockResolvedValue(undefined);
    const { container } = render(wrap(<NewShelfBench onLog={vi.fn()} onCreated={onCreated} />));
    const docket = docketOf(container);
    await screen.findByLabelText('Facility');
    expect(docket.querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();
    expect(
      within(lineOf(docket, 'Serial')).getByText('Minted when it is created'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Zone'), 'C-3');
    await user.click(screen.getByLabelText('Oversized storage'));
    await user.selectOptions(screen.getByLabelText('Facility'), 'TA');
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('Zone C-3');
    expect(within(lineOf(docket, 'Storage kind')).getByText('Oversized')).toBeInTheDocument();
    expect(within(lineOf(docket, 'Facility')).getByText('Bault Tel Aviv')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create shelf' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/custody/bins', {
        zone: 'C-3',
        facilityCode: 'TA',
        oversized: true,
      }),
    );
    await waitFor(() => expect(outcomeOf(docket)).toHaveTextContent('BIN-NEW00001'));
    expect(onCreated).toHaveBeenCalled();
  });
});

describe('packing a shipment from its pick list', () => {
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

  async function load() {
    get.mockImplementation((path: string) =>
      path === '/shipping/shipments/shp-1' ? Promise.resolve(DETAIL) : Promise.resolve([]),
    );
    const user = userEvent.setup();
    const onLog = vi.fn();
    const view = render(wrap(<FulfillmentBench onLog={onLog} />));
    const docket = docketOf(view.container);
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('No shipment loaded');
    await user.type(screen.getByLabelText('Shipment ID'), 'shp-1{Enter}');
    await screen.findByLabelText(/scan each item/i);
    return { user, onLog, docket, ...view };
  }

  it('is the shipment, where it goes, a line for each card that is to be scanned, and how many are done of how many', async () => {
    const { docket } = await load();
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('SHP-PACK0001');
    expect(docket.querySelector('.drawer-tag-amount')).toHaveTextContent('0 / 2');
    expect(within(lineOf(docket, 'Goes to')).getByText(/12 Vine St/)).toBeInTheDocument();
    expect(docket.querySelectorAll('.pill')).toHaveLength(2);
    expect(within(docket).getAllByText('Not scanned yet')).toHaveLength(2);
  });

  it('ticks a card as it is scanned, shows what is not in the shipment as wrong, with the way to take it back', async () => {
    const { user, docket } = await load();
    const scan = screen.getByLabelText(/scan each item/i);
    await user.type(scan, 'sn-one-0001{Enter}');
    expect(docket.querySelector('.drawer-tag-amount')).toHaveTextContent('1 / 2');
    expect(within(docket).getByText('Scanned')).toBeInTheDocument();

    await user.type(scan, 'SN-NOPE-9999{Enter}');
    expect(within(docket).getByText('Not in this shipment')).toBeInTheDocument();
    await user.click(within(docket).getByRole('button', { name: /remove SN-NOPE-9999/i }));
    expect(within(docket).queryByText('Not in this shipment')).toBeNull();
  });

  it('says it went, with its tracking number, and goes back to having no shipment loaded', async () => {
    post.mockResolvedValue({ trackingNumber: 'SBX-1' });
    const { user, docket } = await load();
    const scan = screen.getByLabelText(/scan each item/i);
    await user.type(scan, 'SN-ONE-0001{Enter}');
    await user.type(scan, 'SN-TWO-0002{Enter}');
    await user.type(screen.getByLabelText('Notes'), 'Rigid mailer.');
    await user.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => expect(outcomeOf(docket)).toHaveTextContent('Dispatched'));
    expect(outcomeOf(docket)).toHaveTextContent('SHP-PACK0001 · SBX-1');
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('No shipment loaded');
  });
});

describe('receiving an arrival', () => {
  it('is the parcel as it will be recorded: the name as it was written on it, who brought it, how it is traced, and how many photographs', async () => {
    const user = userEvent.setup();
    const { container } = render(
      wrap(<ReceiveParcels onReceived={vi.fn().mockResolvedValue(undefined)} />),
    );
    await screen.findByLabelText('Facility');
    const docket = docketOf(container);
    expect(docket.querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();
    expect(within(lineOf(docket, 'Facility')).getByText('Bault New Jersey')).toBeInTheDocument();
    expect(lineOf(docket, 'Carrier')).toHaveTextContent('—');
    expect(within(docket).queryByText('Shipped from', { selector: 'dt' })).toBeNull();

    await user.type(screen.getByLabelText('Username on the parcel'), 'r.ashwod');
    await user.type(screen.getByLabelText('Carrier'), 'DHL Express');
    await user.type(screen.getByLabelText('Tracking number'), '1Z999AA10123456784');
    await user.click(screen.getByLabelText('Shipped from outside the US'));
    expect(docket.querySelector('.drawer-tag-title')).toHaveTextContent('r.ashwod');
    expect(within(lineOf(docket, 'Carrier')).getByText('DHL Express')).toBeInTheDocument();
    expect(
      within(lineOf(docket, 'Tracking number')).getByText('1Z999AA10123456784'),
    ).toBeInTheDocument();
    expect(within(lineOf(docket, 'Shipped from')).getByText('Outside the US')).toBeInTheDocument();
  });

  it('says what it was recorded as, and clears the form for the next box', async () => {
    post.mockResolvedValue([{ code: 'PKG-NEW00001', status: 'unclaimed' }]);
    const user = userEvent.setup();
    const { container } = render(
      wrap(<ReceiveParcels onReceived={async (fn) => void (await fn())} />),
    );
    await screen.findByLabelText('Facility');
    await user.type(screen.getByLabelText('Username on the parcel'), 'r.ashwod');
    await user.click(screen.getByRole('button', { name: 'Receive parcel' }));
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('Received'));
    expect(outcome).toHaveTextContent('PKG-NEW00001 · unclaimed');
    expect(screen.getByLabelText('Username on the parcel')).toHaveValue('');
  });

  it('keeps what was typed when the parcel did not go in, and says why on the docket (the console swallows the error into its log)', async () => {
    post.mockRejectedValue(new Error('Facility is closed.'));
    const user = userEvent.setup();
    // What the console does with a failure: it writes it to a log and does not throw.
    const swallow = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        // logged
      }
    };
    const { container } = render(wrap(<ReceiveParcels onReceived={swallow} />));
    await screen.findByLabelText('Facility');
    await user.type(screen.getByLabelText('Username on the parcel'), 'r.ashwod');
    await user.click(screen.getByRole('button', { name: 'Receive parcel' }));
    const outcome = outcomeOf(docketOf(container));
    await waitFor(() => expect(outcome).toHaveTextContent('Not done'));
    expect(outcome).toHaveTextContent('Facility is closed.');
    expect(screen.getByLabelText('Username on the parcel')).toHaveValue('r.ashwod');
  });
});

describe('booking in, on the bench', () => {
  const PARCEL = {
    id: 'p1',
    code: 'PKG-AAAA1111',
    status: 'opened',
    addressedTo: 'red',
    ownerUsername: 'red',
    facilityName: 'Bault New Jersey',
    facilityRole: 'primary',
    facilityCode: 'NJ',
    forwardedAt: null,
    receivedAt: '2026-09-01T10:00:00.000Z',
    trackingNumber: 'TRACK-1',
    itemCount: 2,
    internationalOrigin: false,
  };

  beforeEach(() => {
    get.mockImplementation((path: string) => {
      if (path === '/parcels') return Promise.resolve([PARCEL]);
      if (path === '/me/inbound-addresses') return Promise.resolve(FACILITIES);
      if (path.startsWith('/custody/bins/suggest')) {
        return Promise.resolve({
          id: 'b1',
          serialNumber: 'BIN-QJLTDJH4',
          barcode: 'BIN-QJLTDJH4',
          zone: 'A',
          itemCount: 3,
          facilityCode: 'NJ',
        });
      }
      return Promise.resolve([]);
    });
  });

  async function bench() {
    window.location.hash = '#/warehouse/receiving';
    const user = userEvent.setup();
    render(wrap(<WarehouseConsole />));
    const heading = await screen.findByRole('heading', { name: 'Receive bench' });
    const panel = heading.closest('section') as HTMLElement;
    const docket = (await waitFor(() => {
      const found = panel.querySelector('.request-slip') as HTMLElement | null;
      expect(found).not.toBeNull();
      return found;
    }))!;
    await waitFor(() => expect(within(docket).getByText('BIN-QJLTDJH4')).toBeInTheDocument());
    return { user, panel, docket };
  }

  it('is the units (a dash until one is described), whose they are, from which box, to which shelf, and where that shelf stands', async () => {
    const { user, docket, panel } = await bench();
    expect(docket.querySelector('.drawer-tag-kicker')).toHaveTextContent('Units');
    expect(docket.querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    expect(lineOf(docket, 'Owner')).toHaveTextContent('—');
    expect(
      within(lineOf(docket, 'From parcel')).getByText('No parcel (received by hand)'),
    ).toBeInTheDocument();
    expect(within(docket).getByText(/Zone A · 3 items on it now/)).toBeInTheDocument();

    await user.type(within(panel).getByLabelText('Owner username'), 'red');
    await user.type(within(panel).getByLabelText(/^description/i), '2005 Rayquaza ★');
    await user.type(within(panel).getByLabelText('Condition'), 'PSA 9');
    expect(docket.querySelector('.drawer-tag-amount')).toHaveTextContent('1');
    expect(within(lineOf(docket, 'Owner')).getByText('@red')).toBeInTheDocument();
    expect(within(docket).getByText(/2005 Rayquaza ★/)).toBeInTheDocument();
    expect(within(docket).getByText('Trading card · PSA 9')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Another unit' }));
    await user.type(within(panel).getAllByLabelText(/^description/i)[1]!, 'A second card');
    expect(docket.querySelector('.drawer-tag-amount')).toHaveTextContent('2');
    expect(within(panel).getByRole('button', { name: 'Book in 2 units' })).toBeInTheDocument();
  });

  it('names the parcel it is for, and the shelf that was scanned instead of the suggested one', async () => {
    const { user, docket, panel } = await bench();
    await user.selectOptions(within(panel).getByLabelText('From parcel'), 'p1');
    expect(within(lineOf(docket, 'From parcel')).getByText('PKG-AAAA1111')).toBeInTheDocument();
    expect(within(lineOf(docket, 'Owner')).getByText('@red')).toBeInTheDocument();

    await user.selectOptions(within(panel).getByLabelText('Where it goes'), 'scan');
    await user.type(within(panel).getByLabelText('Scan shelf'), 'BIN-5LPJN5LR');
    expect(within(lineOf(docket, 'Shelf')).getByText('BIN-5LPJN5LR')).toBeInTheDocument();
  });

  it('says what was booked in and where, and what went wrong where the hands are', async () => {
    post.mockResolvedValueOnce([{ id: 'i1', barcode: 'SN-ABC-1234' }]);
    const { user, docket, panel } = await bench();
    await user.type(within(panel).getByLabelText('Owner username'), 'red');
    await user.type(within(panel).getByLabelText(/^description/i), 'A card');
    await user.click(within(panel).getByRole('button', { name: 'Intake' }));
    await waitFor(() => expect(outcomeOf(docket)).toHaveTextContent('Booked in'));
    expect(outcomeOf(docket)).toHaveTextContent('1 → BIN-QJLTDJH4');

    post.mockRejectedValueOnce(new Error('Serial already exists.'));
    await user.type(within(panel).getByLabelText('Owner username'), 'red');
    await user.type(within(panel).getByLabelText(/^description/i), 'Another card');
    await user.click(within(panel).getByRole('button', { name: 'Intake' }));
    await waitFor(() => expect(outcomeOf(docket)).toHaveTextContent('Not done'));
    expect(outcomeOf(docket)).toHaveTextContent('Serial already exists.');
  });
});

describe('a sale from the store, to be labelled and shelved', () => {
  const ORDER = {
    id: 'o1',
    code: 'HO-0001',
    createdAt: '2026-10-27T09:00:00.000Z',
    itemId: 'it1',
    serialNumber: 'SN-STORE-0001',
    barcode: 'SN-STORE-0001',
    description: '2005 Pokémon EX Deoxys — Rayquaza ★',
    conditionGrade: 'PSA 9',
    photoRef: null,
    listingCode: 'HL-0042',
    buyerUsername: 'golden',
  };

  it('is a tag: its number, the card, the serial, who bought it, from which listing and when, and the label to stick on it', async () => {
    get.mockImplementation((path: string) =>
      path === '/marketplace/house/orders/queue' ? Promise.resolve([ORDER]) : Promise.resolve([]),
    );
    render(wrap(<HouseOrdersPanel onLog={vi.fn()} />));
    const tag = await screen.findByRole('article', { name: 'HO-0001' });
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('Rayquaza');
    expect(within(lineOf(tag, 'Serial')).getByText('SN-STORE-0001')).toBeInTheDocument();
    expect(within(lineOf(tag, 'Buyer')).getByText('@golden')).toBeInTheDocument();
    expect(within(lineOf(tag, 'Listing')).getByText('HL-0042')).toBeInTheDocument();
    // The list of them is tags, not a column of forms.
    expect(tag.closest('ul')).toHaveClass('tag-grid');
  });

  it('is shelved on the shelf that was scanned, or on one the system directs when none was', async () => {
    get.mockImplementation((path: string) =>
      path === '/marketplace/house/orders/queue' ? Promise.resolve([ORDER]) : Promise.resolve([]),
    );
    post.mockResolvedValue({ serialNumber: 'SN-STORE-0001', binBarcode: 'BIN-RF5DBQ7Q' });
    const user = userEvent.setup();
    const onLog = vi.fn();
    render(wrap(<HouseOrdersPanel onLog={onLog} />));
    await screen.findByRole('article', { name: 'HO-0001' });
    await user.type(screen.getByLabelText('Scan shelf'), 'BIN-RF5DBQ7Q{Enter}');
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/marketplace/house/orders/o1/stow', {
        binId: 'BIN-RF5DBQ7Q',
        photoKeys: [],
      }),
    );
    await waitFor(() => expect(onLog).toHaveBeenCalled());
  });
});

describe.skipIf(!browser)('the benches, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`a bench is read, edged and reached, and its docket is paper: ${theme}, ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        post.mockResolvedValue({});
        const user = userEvent.setup();
        render(wrap(<RelocateBench shelves={SHELVES} onLog={vi.fn()} onDone={vi.fn()} />));
        await user.type(document.querySelector('input')!, 'SN-CL10-0005');
        const inputs = document.querySelectorAll('input');
        await user.type(inputs[1]!, 'BIN-RF5DBQ7Q');
        const page = await inBrowser(390, locale, theme, true);
        const docket = await page.$eval('.request-slip .drawer-tag', (el) => {
          const style = getComputedStyle(el);
          return { bg: style.backgroundColor, color: style.color };
        });
        expect(docket).toEqual({ bg: 'rgb(243, 239, 230)', color: 'rgb(21, 19, 15)' });
        expect(await audit.auditButtons(page)).toEqual([]);
        const flags = await audit.audit(page);
        expect(flags.filter((f) => /color-contrast/.test(f))).toEqual([]);
        await page.context().close();
      });
    }
  }

  it('reads a scan in the code’s face, left to right, with the glyph of what scans at its start, in either language', async () => {
    for (const locale of ['en', 'he'] as const) {
      localStorage.setItem('bault.locale', locale);
      const { unmount } = render(wrap(<HoldBench onLog={vi.fn()} onDone={vi.fn()} />));
      const page = await inBrowser(1100, locale, 'dark');
      const read = await page.$eval('.scan-input', (el) => {
        const input = el.querySelector('input')!;
        const style = getComputedStyle(input);
        const svg = el.querySelector('svg')!.getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return {
          direction: style.direction,
          family: style.fontFamily,
          height: Math.round(box.height),
          glyphAtLeft: svg.left - box.left < 24,
        };
      });
      expect(read.direction).toBe('ltr');
      expect(read.family).toMatch(/mono|Geist Mono|ui-monospace/i);
      expect(read.height).toBeGreaterThanOrEqual(48);
      expect(read.glyphAtLeft).toBe(true);
      await page.context().close();
      unmount();
    }
  });

  it('keeps the docket the height it was when an outcome comes: nothing under it jumps', async () => {
    post.mockResolvedValue({});
    const user = userEvent.setup();
    render(wrap(<RelocateBench shelves={SHELVES} onLog={vi.fn()} onDone={vi.fn()} />));
    const before = await inBrowser(1100, 'en', 'dark');
    const heightBefore = await before.$eval('.request-slip', (el) =>
      Math.round(el.getBoundingClientRect().height),
    );
    await before.context().close();

    await user.type(screen.getByLabelText('Scan item'), 'SN-CL10-0005');
    await user.type(screen.getByLabelText('Scan shelf'), 'BIN-RF5DBQ7Q');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.querySelector('.docket-outcome')).toHaveTextContent('Moved'),
    );
    // The fields are empty again, so the docket is as it began, with the outcome in its foot.
    const after = await inBrowser(1100, 'en', 'dark');
    const heightAfter = await after.$eval('.request-slip', (el) =>
      Math.round(el.getBoundingClientRect().height),
    );
    await after.context().close();
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThanOrEqual(24);
  });

  it('puts the docket beside the fields on a wide window (with more room for them than a request has) and above the button on a phone', async () => {
    render(wrap(<ReceiveParcels onReceived={vi.fn()} />));
    await screen.findByLabelText('Facility');
    for (const width of [1440, 390]) {
      const page = await inBrowser(width, 'en', 'dark', width < 800);
      const box = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const fields = rect('.request-form-fields');
        const slip = rect('.request-slip');
        const actions = rect('.request-form-actions');
        return {
          fieldsWidth: Math.round(fields.width),
          beside: slip.left >= fields.right - 1 || slip.right <= fields.left + 1,
          between: slip.top >= fields.bottom - 1 && actions.top >= slip.bottom - 1,
        };
      });
      if (width >= 1100) {
        expect(box.beside).toBe(true);
        expect(box.fieldsWidth).toBeGreaterThan(600);
      } else {
        expect(box.between).toBe(true);
      }
      await page.context().close();
    }
  });
});
