import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Dispatch sends what the operator SCANNED, not the shipment's own list.
 *
 * The API refuses a dispatch unless the scanned set equals the shipment's items.
 * The screen used to send `detail.itemIds` behind tick-boxes, so the check
 * compared the list with itself and could not fail — a wrong card in the box
 * shipped. These pin the scanning behaviour.
 */
const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
  // `errorText` asks the module which failure this was.
  apiErrorKey: () => null,
}));
vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: () => null,
  BarcodeLabel: () => null,
  BarcodePrintButton: () => null,
  BarcodePrintAllButton: () => null,
  printBarcode: () => {},
  printBarcodes: () => {},
}));

const { WarehouseConsole } = await import('../../apps/web/src/areas/warehouse/WarehouseConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const SHIPMENT = {
  id: 'shp-1',
  code: 'SHP-TEST',
  status: 'rates_selected',
  carrier: 'USPS',
  itemIds: ['item-a', 'item-b'],
  items: [
    { id: 'item-a', serialNumber: 'SN-DX107-0003', barcode: 'SN-DX107-0003', description: 'Rayquaza Gold Star' },
    { id: 'item-b', serialNumber: 'SN-CL10-0005', barcode: 'SN-CL10-0005', description: 'Rayquaza Call of Legends' },
  ],
  destinationAddress: '1 Test St, Newark NJ',
  boxSize: 'rigid_mailer',
};

function renderShipmentsTab() {
  window.location.hash = '#/warehouse/shipments';
  return render(
    <I18nProvider>
      <WarehouseConsole />
    </I18nProvider>,
  );
}

async function loadShipment(user: ReturnType<typeof userEvent.setup>) {
  // The bench takes the SHP- code people read off the slip; the API resolves it.
  await user.type(await screen.findByLabelText('Shipment code'), 'SHP-TEST');
  await user.click(screen.getByRole('button', { name: /^open$/i }));
  await screen.findByText('SN-DX107-0003');
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  // Weight is no longer prefilled: a parcel nobody weighed must not pass.
  await user.type(screen.getByLabelText(/package weight/i), '120');
  await user.type(screen.getByLabelText('Notes'), 'Packed and sealed');
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) =>
    path.startsWith('/shipping/shipments/') ? Promise.resolve(SHIPMENT) : Promise.resolve([]),
  );
  post.mockResolvedValue({ trackingNumber: 'SBX123' });
});

describe('warehouse dispatch', () => {
  it('sends only the items that were scanned, and only once every item is scanned', async () => {
    const user = userEvent.setup();
    renderShipmentsTab();
    await loadShipment(user);
    await fillForm(user);

    const scan = screen.getByLabelText(/scan the barcode/i);
    const complete = screen.getByRole('button', { name: /complete/i });

    await user.type(scan, 'SN-DX107-0003{Enter}');
    expect(complete).toBeDisabled(); // one of two

    await user.type(scan, 'SN-CL10-0005{Enter}');
    expect(complete).toBeEnabled();

    await user.click(complete);
    const [path, body] = post.mock.calls.at(-1)!;
    expect(path).toBe('/shipping/shipments/shp-1/dispatch');
    expect((body as { scannedItemIds: string[] }).scannedItemIds.sort()).toEqual(['item-a', 'item-b']);
    // The carrier the customer paid for is the one preselected.
    expect((body as { carrier: string }).carrier).toBe('USPS');
    // And the tracking number is said on the bench, not only in a log.
    expect(await screen.findByText(/Tracking number: SBX123/)).toBeInTheDocument();
  });

  it('blocks completion when a card that is not in the shipment is scanned', async () => {
    const user = userEvent.setup();
    renderShipmentsTab();
    await loadShipment(user);
    await fillForm(user);

    const scan = screen.getByLabelText(/scan the barcode/i);
    await user.type(scan, 'SN-DX107-0003{Enter}');
    await user.type(scan, 'SN-CL10-0005{Enter}');
    await user.type(scan, 'SN-ROS104-0007{Enter}'); // not in this shipment

    expect(screen.getByRole('alert')).toHaveTextContent('SN-ROS104-0007 is not in this shipment');
    expect(screen.getByRole('button', { name: /complete/i })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
