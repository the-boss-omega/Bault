import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The receiving bench as an operator works it.
 *
 * Three defects, all the same shape — the product described the work instead of
 * fitting it:
 *
 *   1. Parcels and intake were TWO TABS for one piece of work. "Book contents"
 *      switched tabs, and the box was closed out on the far side.
 *   2. Arrivals were booked in ONE AT A TIME, so the facility and carrier were
 *      re-entered for every box a courier dropped.
 *   3. NOTHING could be photographed — no route in the API accepted image bytes.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { WarehouseConsole } = await import('../../apps/web/src/areas/warehouse/WarehouseConsole');
const { PhotoInput } = await import('../../apps/web/src/shared/ui/PhotoInput');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const FACILITIES = [{ facilityId: 'f1', code: 'NJ', name: 'Bault New Jersey', role: 'primary' }];

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

function apiFor(overrides: Record<string, unknown> = {}) {
  return (path: string) => {
    const table: Record<string, unknown> = {
      '/parcels': [PARCEL],
      '/me/inbound-addresses': FACILITIES,
      '/custody/bins': [],
      '/custody/report': [],
      '/intake/lots': [],
      '/parcels/workflow/status': { received: 1, opened: 1, unclaimed: 0 },
      ...overrides,
    };
    if (path.startsWith('/custody/bins/suggest')) {
      return Promise.resolve({ id: 'b1', serialNumber: 'BIN-QJLTDJH4', zone: 'A', itemCount: 3 });
    }
    const key = Object.keys(table).find((k) => path.startsWith(k));
    return Promise.resolve(key !== undefined ? table[key] : []);
  };
}

function renderConsole(hash = '#/warehouse/receiving') {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <WarehouseConsole />
    </I18nProvider>,
  );
}

function panel(titlePattern: RegExp): HTMLElement {
  const heading = screen
    .getAllByRole('heading')
    .find((h) => titlePattern.test(h.textContent ?? ''));
  if (!heading) throw new Error(`no panel titled ${titlePattern}`);
  const section = heading.closest('section');
  if (!section) throw new Error(`panel ${titlePattern} has no section`);
  return section as HTMLElement;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(apiFor());
});

describe('one bench, not two tabs', () => {
  it('shows receiving, the queue and the intake bench on the same screen', async () => {
    /**
     * The split cut one piece of work in half. An operator emptying a box moved
     * between two tabs to do it, and the count of what had come out was visible
     * on one of them at a time.
     */
    renderConsole();

    await waitFor(() => expect(panel(/receive an arrival/i)).toBeInTheDocument());
    expect(panel(/parcel/i)).toBeInTheDocument();
    expect(panel(/receive bench/i)).toBeInTheDocument();
  });

  it('points the bench at the box instead of navigating away from it', async () => {
    const user = userEvent.setup();
    renderConsole();

    const queueRow = await screen.findByText('PKG-AAAA1111');
    const row = queueRow.closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /book contents/i }));

    // Still on the receiving tab, with the bench now naming that parcel.
    expect(window.location.hash).toContain('receiving');
    const bench = panel(/receive bench/i);
    await waitFor(() =>
      expect(within(bench).getByRole('combobox', { name: /parcel/i })).toHaveValue('p1'),
    );
  });

  it('keeps shelf work off the receiving bench', async () => {
    // Relocate, hold, break-lot and disposal act on cards ALREADY on a shelf.
    // They were on the intake tab only because that is where the scan fields
    // happened to live, which made the bench a page of five unrelated forms.
    renderConsole();
    await waitFor(() => expect(panel(/receive bench/i)).toBeInTheDocument());
    expect(screen.queryByText(/move something that is already/i)).toBeNull();

    renderConsole('#/warehouse/inventory');
    await waitFor(() => expect(panel(/move|relocat/i)).toBeInTheDocument());
  });
});

describe('booking in a box of different units', () => {
  /**
   * The rows are on the intake bench, not the parcel form, and the reason is
   * what each piece of work actually is. Receiving a parcel is a scan and a
   * label — one field's worth per box. A BOX holds a Rayquaza ex, a sealed pack
   * and a graded Gold Star, each needing its own class, condition, serial and
   * photographs.
   *
   * `quantity` used to stand in for this and could not: it books N copies of ONE
   * description, which is right for a run of identical commons and wrong for
   * everything else.
   */
  it('has no quantity stepper', async () => {
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));
    expect(within(bench).queryByLabelText(/quantity/i)).toBeNull();
    expect(within(bench).queryByRole('spinbutton', { name: /quantity/i })).toBeNull();
  });

  it('asks for the owner and the shelf once, not once per unit', async () => {
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    await user.click(within(bench).getByRole('button', { name: /another unit/i }));

    // Two units, one owner and one stow control.
    expect(within(bench).getAllByLabelText(/description/i)).toHaveLength(2);
    expect(within(bench).getAllByLabelText(/owner username/i)).toHaveLength(1);
    expect(within(bench).getAllByLabelText(/where it goes|stow/i).length).toBeGreaterThan(0);
  });

  it('sends every filled unit in one call, each with its own detail', async () => {
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    await user.click(within(bench).getByRole('button', { name: /another unit/i }));

    await user.type(within(bench).getByLabelText(/owner username/i), 'red');
    const descriptions = within(bench).getAllByLabelText(/description/i);
    await user.type(descriptions[0]!, 'Rayquaza ex 97/97');
    await user.type(descriptions[1]!, 'Rayquaza Gold Star 107/107');

    // Each row carries its own class.
    const classes = within(bench).getAllByLabelText(/type \/ class/i);
    await user.selectOptions(classes[1]!, 'graded_slab');

    post.mockResolvedValue([{ id: 'i1', barcode: 'SN-1' }, { id: 'i2', barcode: 'SN-2' }]);
    await user.click(within(bench).getByRole('button', { name: /book in 2 units/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/intake/items/batch', expect.anything()));
    const [, body] = post.mock.calls.find(([p]) => p === '/intake/items/batch')!;
    const sent = (body as { units: Record<string, unknown>[] }).units;
    expect(sent).toHaveLength(2);
    expect(sent.map((u) => u.description)).toEqual(['Rayquaza ex 97/97', 'Rayquaza Gold Star 107/107']);
    expect(sent.map((u) => u.typeClass)).toEqual(['trading_card', 'graded_slab']);
    // The shared answers are copied onto every unit rather than asked twice.
    expect(sent.every((u) => u.ownerUsername === 'red' && u.autoStow === true)).toBe(true);
    // And nothing sends a quantity any more.
    expect(sent.every((u) => u.quantity === undefined)).toBe(true);
  });

  it('ignores a trailing unit nobody has reached yet', async () => {
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    await user.click(within(bench).getByRole('button', { name: /another unit/i }));
    await user.type(within(bench).getByLabelText(/owner username/i), 'red');
    await user.type(within(bench).getAllByLabelText(/description/i)[0]!, 'Only this one');

    post.mockResolvedValue([{ id: 'i1', barcode: 'SN-1' }]);
    await user.click(within(bench).getByRole('button', { name: /^intake$/i }));

    const [, body] = post.mock.calls.find(([p]) => p === '/intake/items/batch')!;
    expect((body as { units: unknown[] }).units).toHaveLength(1);
  });

  it('will not submit with nothing described', async () => {
    const user = userEvent.setup();
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));
    await user.type(within(bench).getByLabelText(/owner username/i), 'red');
    expect(within(bench).getByRole('button', { name: /^intake$/i })).toBeDisabled();
  });

  it('offers the lot box only while there is one unit', async () => {
    // A lot is ONE record standing for many things, so it cannot describe a
    // submission of several — hidden rather than offered and then ignored.
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    expect(within(bench).getByLabelText(/lot/i)).toBeInTheDocument();

    await user.click(within(bench).getByRole('button', { name: /another unit/i }));
    expect(within(bench).queryByLabelText(/^.*lot.*$/i)).toBeNull();
  });
});

describe('booking in one parcel', () => {
  it('is a single form again, because a box is one scan', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue([{ id: 'p9', code: 'PKG-NEW' }]);
    renderConsole();

    const receiving = await waitFor(() => panel(/receive an arrival/i));
    expect(within(receiving).queryByRole('button', { name: /another parcel/i })).toBeNull();
    expect(within(receiving).getAllByLabelText(/username on the parcel/i)).toHaveLength(1);

    await user.type(within(receiving).getByLabelText(/username on the parcel/i), 'red');
    await user.click(within(receiving).getByRole('button', { name: /^receive parcel$/i }));

    // Still the batch route, with one entry — that is what makes it atomic.
    const [, body] = post.mock.calls.find(([p]) => p === '/parcels/receive/batch')!;
    expect((body as { parcels: unknown[] }).parcels).toHaveLength(1);
  });

  it('will not submit an empty form', async () => {
    renderConsole();
    const receiving = await waitFor(() => panel(/receive an arrival/i));
    expect(within(receiving).getByRole('button', { name: /^receive parcel$/i })).toBeDisabled();
  });
});

describe('photographs', () => {
  /** jsdom has no camera; a File is what the picker would hand over. */
  const file = () => new File([new Uint8Array([1, 2, 3])], 'box.png', { type: 'image/png' });

  beforeEach(() => {
    // jsdom implements neither, and both are used to preview a chosen file.
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:preview', writable: true });
      Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
    }
  });

  it('uploads on selection and holds the key, never the bytes', async () => {
    /**
     * Two steps, matching the API: bytes go to `/media/uploads` and the form
     * sends the KEY with whatever it is creating. Uploading immediately is what
     * lets an operator photograph a box while they are still typing its tracking
     * number.
     */
    const user = userEvent.setup();
    post.mockResolvedValue({ objectKey: 'parcels/2026/09/abc.png' });
    const onChange = vi.fn();

    render(
      <I18nProvider>
        <PhotoInput purpose="parcel" value={[]} onChange={onChange} label="Arrival photos" />
      </I18nProvider>,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file());

    await waitFor(() => expect(post).toHaveBeenCalledWith('/media/uploads', expect.anything()));
    const [, body] = post.mock.calls[0]!;
    expect((body as { purpose: string }).purpose).toBe('parcel');
    expect((body as { contentType: string }).contentType).toBe('image/png');

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ objectKey: 'parcels/2026/09/abc.png' })]),
    );
  });

  it('opens the camera on a phone rather than a file browser', () => {
    render(
      <I18nProvider>
        <PhotoInput purpose="parcel" value={[]} onChange={() => {}} label="Arrival photos" />
      </I18nProvider>,
    );
    const input = document.querySelector('input[type="file"]')!;
    // The whole point at a receiving bench: the alternative is a picker pointed
    // at a photo somebody has to take in another app first.
    expect(input).toHaveAttribute('capture', 'environment');
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/'));
  });

  it('shows each photo with a way to take it back off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <PhotoInput
          purpose="parcel"
          value={[{ objectKey: 'k1', previewUrl: 'blob:one', name: 'box.png' }]}
          onChange={onChange}
          label="Arrival photos"
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('img', { name: 'box.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove box\.png/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('stops offering the control once the cap is reached', () => {
    const full = Array.from({ length: 6 }, (_, i) => ({
      objectKey: `k${i}`,
      previewUrl: 'blob:x',
      name: `p${i}.png`,
    }));
    render(
      <I18nProvider>
        <PhotoInput purpose="parcel" value={full} onChange={() => {}} label="Arrival photos" max={6} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: /add another|add a photo/i })).toBeNull();
  });

  it('sends each unit’s photos with that unit', async () => {
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    // The bench offers the control at all — it did not exist.
    expect(within(bench).getAllByText(/item photos/i).length).toBeGreaterThan(0);

    post.mockResolvedValue({ objectKey: 'intake/2026/09/xyz.png' });
    const inputs = bench.querySelectorAll('input[type="file"]');
    await user.upload(inputs[0] as HTMLInputElement, file());
    await waitFor(() => expect(post).toHaveBeenCalledWith('/media/uploads', expect.anything()));

    post.mockResolvedValue([{ id: 'i1', barcode: 'SN-1' }]);
    await user.type(within(bench).getByLabelText(/owner username/i), 'red');
    await user.type(within(bench).getByLabelText(/description/i), 'Photographed');
    await user.click(within(bench).getByRole('button', { name: /^intake$/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/intake/items/batch', expect.anything()));
    const [, body] = post.mock.calls.find(([p]) => p === '/intake/items/batch')!;
    const units = (body as { units: { photoKeys: string[] }[] }).units;
    expect(units[0]!.photoKeys).toEqual(['intake/2026/09/xyz.png']);
  });
});

describe('the labels an intake produces', () => {
  /**
   * Every unit needs a label stuck on it before it goes to its shelf, and the
   * barcode is what every later scan reads — the shelf scan, the pick, the
   * dispatch. So the print control is the last thing on the bench rather than
   * something to go and find afterwards.
   */
  it('shows a label per unit, with one control that prints the whole run', async () => {
    const user = userEvent.setup();
    renderConsole();

    const bench = await waitFor(() => panel(/receive bench/i));
    await user.click(within(bench).getByRole('button', { name: /another unit/i }));
    await user.type(within(bench).getByLabelText(/owner username/i), 'red');
    const descriptions = within(bench).getAllByLabelText(/description/i);
    await user.type(descriptions[0]!, 'Rayquaza ex 97/97');
    await user.type(descriptions[1]!, 'Rayquaza Gold Star 107/107');

    post.mockResolvedValue([
      { id: 'i1', barcode: 'SN-AAAA1111-0001' },
      { id: 'i2', barcode: 'SN-BBBB2222-0002' },
    ]);
    await user.click(within(bench).getByRole('button', { name: /book in 2 units/i }));

    // One label each…
    await waitFor(() => expect(screen.getByText(/labels for what you just booked in/i)).toBeInTheDocument());
    expect(within(bench).getAllByRole('button', { name: /print the barcode/i })).toHaveLength(2);

    // …and one control for the run, which is what stops twelve units meaning
    // twelve trips to the print dialog.
    expect(within(bench).getByRole('button', { name: /print all 2 labels/i })).toBeInTheDocument();
  });

  it('offers nothing to print before anything has been booked in', async () => {
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));
    expect(within(bench).queryByRole('button', { name: /print all/i })).toBeNull();
    expect(screen.queryByText(/labels for what you just booked in/i)).toBeNull();
  });
});

describe('when there is nowhere to put it', () => {
  /**
   * The directed stow refuses for exactly two reasons — no shelving of the kind
   * this run needs, or none in this building — and both of them used to end the
   * run. The operator stood at an open box reading "create one before stowing
   * this", with the form that does it on another tab: leave the bench, lose the
   * units already typed into it, come back and start the box again.
   */
  it('offers the shelf form at the refusal, and asks again once one exists', async () => {
    const user = userEvent.setup();
    let shelfExists = false;
    get.mockImplementation((path: string) => {
      if (path.startsWith('/custody/bins/suggest')) {
        return shelfExists
          ? Promise.resolve({ id: 'b9', serialNumber: 'BIN-NEWSHELF', zone: 'C-2', itemCount: 0 })
          : Promise.reject(new Error('No active bin is available here — create one before stowing this'));
      }
      return apiFor()(path);
    });
    post.mockImplementation((path: string) => {
      if (path !== '/custody/bins') return Promise.resolve([]);
      shelfExists = true;
      return Promise.resolve({ id: 'b9', serialNumber: 'BIN-NEWSHELF', zone: 'C-2' });
    });

    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));
    await within(bench).findByText(/no active bin is available/i);

    await user.type(within(bench).getByLabelText(/zone for the new shelf/i), 'C-2');
    await user.click(within(bench).getByRole('button', { name: /create a shelf here/i }));

    // The kind and the building are taken from the run, not asked for again:
    // they are the two facts that just failed to match.
    const [, body] = post.mock.calls.find(([p]) => p === '/custody/bins')!;
    expect(body).toMatchObject({ zone: 'C-2', oversized: false });

    // And the answer comes back from where it always does, not from the create.
    await waitFor(() => expect(within(bench).getByText('BIN-NEWSHELF')).toBeInTheDocument());
    expect(within(bench).queryByLabelText(/zone for the new shelf/i)).toBeNull();
  });

  it('stays out of the way while there is somewhere to go', async () => {
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));
    await within(bench).findByText('BIN-QJLTDJH4');
    expect(within(bench).queryByRole('button', { name: /create a shelf here/i })).toBeNull();
  });
});
