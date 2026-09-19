import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The receive bench, which is where the physical work happens.
 *
 * An operator stands at a table with a box and drives this screen. If the stow
 * target is wrong they walk to the wrong shelf; if the submitted payload is
 * wrong the card is recorded in a place it is not. Neither is visible to a type
 * checker, and until now nothing else looked either.
 */

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

/** Barcode rendering draws to a canvas jsdom does not implement. */
/**
 * Barcodes are stubbed here: this file is about the STOW decision, and the Code
 * 128 encoder is covered on its own in `barcode-printing.test.tsx`.
 *
 * The mock has to keep pace with the module's exports — a missing one throws at
 * import time, which surfaces as an unhandled error rather than a failed
 * assertion and is a genuinely confusing way to find out.
 */
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

/** Answers the console's fan-out of loads by path. */
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
  /**
   * `receiving`, not `intake`.
   *
   * The parcel bench and the intake bench were two tabs describing one piece of
   * work — a box is received, opened, and its contents booked in — and "Book
   * contents" switched tabs to get from one half to the other. They are one tab
   * now. `#/warehouse/intake` still resolves for anybody holding the old link
   * (`LEGACY_TABS` in `shared/routing`, covered by the routing suite), but that
   * redirect runs in the app shell, and this test mounts the console alone.
   */
  window.location.hash = '#/warehouse/receiving';
  return render(
    <I18nProvider>
      <WarehouseConsole />
    </I18nProvider>,
  );
}


/**
 * Scope a query to one panel.
 *
 * The console renders several panels at once — receive bench, relocate, lots,
 * disposals — and many share field labels, so an unscoped `getByLabelText`
 * matches four things and throws for a reason unrelated to the component. Every
 * `Panel` is a `<section class="panel">` with an `<h2 class="panel-title">`, so
 * the heading is a stable handle on the section around it.
 */
function panel(titlePattern: RegExp, opts: { withTable?: boolean } = {}): HTMLElement {
  const sections = screen
    .getAllByRole('heading')
    .filter((h) => titlePattern.test(h.textContent ?? ''))
    .map((h) => h.closest('section.panel'))
    .filter((s): s is HTMLElement => s !== null);
  // Two panels genuinely share the title "Shelves" — the create form and the
  // list — so a caller can ask for the one holding the table.
  const match = opts.withTable ? sections.find((s) => s.querySelector('table')) : sections[0];
  if (!match) throw new Error(`no panel titled ${titlePattern}`);
  return match;
}

/** The select whose options contain this text — how a real user finds it. */
function selectWithOption(scope: HTMLElement, pattern: RegExp): HTMLSelectElement {
  const found = within(scope)
    .getAllByRole('combobox')
    .find((s) => Array.from(s.querySelectorAll('option')).some((o) => pattern.test(o.textContent ?? '')));
  if (!found) throw new Error(`no select offering ${pattern}`);
  return found as HTMLSelectElement;
}


/**
 * The control with a given accessible name.
 *
 * This was a DOM walk, and the comment above it explained why: every field was
 * `<label class="field"><span class="field-label">Caption</span><input/><span
 * class="field-hint">…</span></label>`, associating the control with its label
 * by nesting — so the label's accessible name was the caption AND the hint run
 * together, and `getByLabelText('Owner username')` matched nothing because the
 * real name was "Owner usernameThe customer's permanent identifier…".
 *
 * That is fixed. Every field in the product now goes through the `Field`
 * primitive, which points a real `<label for>` at the control and attaches the
 * hint with `aria-describedby`, so the standard query works and this helper is
 * now just `getByLabelText` with the exact-match option — kept only so the call
 * sites read the same as they did.
 *
 * The assertion below is the point: it fails if anything reintroduces the old
 * pattern, because the accessible name would silently grow the hint back.
 */
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

    // The system's answer, on screen, before anything is submitted.
    await waitFor(() => expect(within(panel(/receive bench/i)).getByText('BIN-QJLTDJH4')).toBeInTheDocument());
    // …with what is on that shelf now, so the operator can disagree with it.
    expect(within(panel(/receive bench/i)).getByText(/Zone A/)).toBeInTheDocument();

    const suggestCalls = get.mock.calls.filter((c) => String(c[0]).startsWith('/custody/bins/suggest'));
    expect(suggestCalls.length).toBeGreaterThan(0);
  });

  it('asks for oversized shelving when the class needs it', async () => {
    const user = userEvent.setup();
    renderConsole();
    const bench = await waitFor(() => panel(/receive bench/i));

    await user.selectOptions(selectWithOption(bench, /sealed case/i), 'sealed_case');

    // The taxonomy says a sealed case is oversized; the suggestion has to be
    // asked for accordingly or the operator is sent to a card shelf.
    await waitFor(() => {
      const asked = get.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/custody/bins/suggest'));
      expect(asked.some((p) => p.includes('oversized=true'))).toBe(true);
    });
  });

  it('books the item in with autoStow, never with a hand-picked bin id', async () => {
    /**
     * The bench posts a LIST of units now — one row per thing in the box — so
     * the stow decision is read off the first entry. It is shared by the whole
     * submission, which is the point: where a box's contents go is one answer,
     * not one per unit.
     */
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

    // The mode control: Auto vs Scan.
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
    // The operator is standing in front of a shelf; their claim beats the
    // system's, and the payload has to reflect that.
    expect(unit.binId).toBe('BIN-5LPJN5LR');
    expect(unit.autoStow).toBe(false);
  });

  it('will not let an intake be submitted with nowhere to put it', async () => {
    const user = userEvent.setup();
    // No shelf available: the suggestion endpoint refuses.
    get.mockImplementation((path: string) => {
      if (path.startsWith('/custody/bins/suggest')) {
        return Promise.reject(new Error('No active bin is available here — create one before stowing this'));
      }
      return apiFor()(path);
    });

    renderConsole();

    // The reason is on screen, not swallowed…
    expect(await screen.findByText(/no active bin is available/i)).toBeInTheDocument();
    // …and the button that would record a card in no location is disabled.
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
    // The utilisation bar and its denominator are gone; a "12 / 50" would mean
    // the fake capacity had come back.
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
