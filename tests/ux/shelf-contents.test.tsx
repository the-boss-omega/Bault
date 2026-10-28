import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider, useT } = await import('../../apps/web/src/shared/i18n');
const { ShelfMap } = await import('../../apps/web/src/areas/warehouse/ShelfMap');
const { ShelfContents } = await import('../../apps/web/src/areas/warehouse/ShelfContents');
type ShelfBin = import('../../apps/web/src/areas/warehouse/ShelfMap').ShelfBin;

const BINS: ShelfBin[] = [
  { id: 'b1', barcode: 'BIN-AAAA1111', zone: 'A', oversized: false, active: true, itemCount: 2 },
  { id: 'b2', barcode: 'BIN-AAAA2222', zone: 'A', oversized: false, active: true, itemCount: 0 },
  { id: 'b3', barcode: 'BIN-BBBB3333', zone: 'B', oversized: true, active: false, itemCount: 0 },
];
const COUNTS = [
  { key: 'b1', count: 2 },
  { key: 'b2', count: 0 },
  { key: null, count: 1 },
];

const ITEMS = [
  {
    id: 'i1',
    serialNumber: 'SN-CL10-0005',
    barcode: 'SN-CL10-0005',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo',
    conditionGrade: 'PSA 9',
    lifecycleState: 'stored',
    holdFlag: false,
  },
  {
    id: 'i2',
    serialNumber: 'SN-DX107-0003',
    barcode: 'SN-DX107-0003',
    typeClass: 'trading_card',
    description: '',
    conditionGrade: null,
    lifecycleState: 'on-hold',
    holdFlag: true,
  },
];

function shelfOf(bin: ShelfBin, items: unknown[]) {
  return {
    bin: {
      id: bin.id,
      barcode: bin.barcode,
      zone: bin.zone,
      oversized: bin.oversized,
      active: bin.active,
    },
    items,
  };
}

/** The map and what it opens, as the console puts them together. */
function Floor() {
  const t = useT();
  const [open, setOpen] = useState<ShelfBin | null>(null);
  return (
    <>
      <ShelfMap bins={BINS} counts={COUNTS} onOpen={setOpen} t={t} />
      {open && <ShelfContents bin={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const renderFloor = () =>
  render(
    <I18nProvider>
      <Floor />
    </I18nProvider>,
  );

beforeEach(() => {
  get.mockReset();
});

describe('a shelf on the map', () => {
  it('is a button that says what it opens, when the screen can open it', () => {
    renderFloor();
    const slot = screen.getByRole('button', { name: /BIN-AAAA1111/ });
    expect(slot).toHaveAttribute('aria-haspopup', 'dialog');
    expect(slot).toHaveAttribute('title', 'Open shelf BIN-AAAA1111: what is on it');
    // The name a screen reader reads is the shelf itself: its label, its count and what state it is in.
    expect(slot).toHaveTextContent('BIN-AAAA1111');
    expect(slot).toHaveTextContent('2');
    expect(slot).toHaveTextContent(/in stock/i);
    expect(screen.getAllByRole('button')).toHaveLength(BINS.length);
  });

  it('is only a picture of a shelf where nothing is told to open it, and the tray is never a button', () => {
    const { container } = render(
      <I18nProvider>
        <ShelfMapWithoutOpen />
      </I18nProvider>,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelectorAll('.shelf-slot')).toHaveLength(BINS.length + 1);
  });

  it('keeps an oversized shelf two places wide, on its cell', () => {
    renderFloor();
    const cell = screen.getByRole('button', { name: /BIN-BBBB3333/ }).closest('li')!;
    expect(cell).toHaveAttribute('data-wide', 'true');
  });
});

function ShelfMapWithoutOpen() {
  const t = useT();
  return <ShelfMap bins={BINS} counts={COUNTS} t={t} />;
}

describe('what is on a shelf', () => {
  it('lists each item by its number, what it is and where it stands, under the shelf as a tag', async () => {
    get.mockResolvedValueOnce(shelfOf(BINS[0]!, ITEMS));
    const user = userEvent.setup();
    renderFloor();
    await user.click(screen.getByRole('button', { name: /BIN-AAAA1111/ }));

    const dialog = await screen.findByRole('dialog', { name: 'BIN-AAAA1111' });
    expect(get).toHaveBeenCalledWith('/custody/bins/b1/items');

    // The tag: what the figure is, the figure, the kind of shelf and whether it is in use.
    const tag = within(dialog).getByRole('region', { name: 'Items on this shelf' });
    expect(tag).toHaveTextContent('2');
    expect(tag).toHaveTextContent(/Zone.*A/);
    expect(tag).toHaveTextContent(/Kind.*Standard/);
    expect(tag).toHaveTextContent(/in stock/i);

    const rows = await within(dialog).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // A card is its catalogue name up to the first " · "; its number is read left to right whichever way the page reads.
    expect(rows[0]).toHaveTextContent('SN-CL10-0005');
    expect(rows[0]).toHaveTextContent('2011 Pokémon Call of Legends — Rayquaza #SL10/95');
    expect(rows[0]).not.toHaveTextContent('Rare Holo');
    expect(rows[0]).toHaveTextContent('Stored');
    expect(rows[0]).toHaveTextContent('PSA 9');
    expect(within(rows[0]!).getByText('SN-CL10-0005')).toHaveAttribute('dir', 'ltr');
    // An item with no description is its class; one on hold says so.
    expect(rows[1]).toHaveTextContent('trading_card');
    expect(rows[1]).toHaveTextContent('On hold');
  });

  it('says so when a shelf has nothing on it, and still says what shelf it is', async () => {
    get.mockResolvedValueOnce(shelfOf(BINS[1]!, []));
    const user = userEvent.setup();
    renderFloor();
    await user.click(screen.getByRole('button', { name: /BIN-AAAA2222/ }));
    const dialog = await screen.findByRole('dialog', { name: 'BIN-AAAA2222' });
    expect(
      await within(dialog).findByText('Nothing is on this shelf right now.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('region', { name: 'Items on this shelf' })).toHaveTextContent(
      /empty/i,
    );
  });

  it('says a shelf that is out of service is, and lists what is on it all the same', async () => {
    get.mockResolvedValueOnce(shelfOf(BINS[2]!, []));
    const user = userEvent.setup();
    renderFloor();
    await user.click(screen.getByRole('button', { name: /BIN-BBBB3333/ }));
    const dialog = await screen.findByRole('dialog', { name: 'BIN-BBBB3333' });
    expect(within(dialog).getByRole('region', { name: 'Items on this shelf' })).toHaveTextContent(
      /out of service/i,
    );
    expect(within(dialog).getByRole('region', { name: 'Items on this shelf' })).toHaveTextContent(
      /Oversized/,
    );
  });

  it('shows why it could not be read, and reads it again when asked', async () => {
    get.mockRejectedValueOnce(new Error('The server could not be reached.'));
    get.mockResolvedValueOnce(shelfOf(BINS[0]!, ITEMS));
    const user = userEvent.setup();
    renderFloor();
    await user.click(screen.getByRole('button', { name: /BIN-AAAA1111/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/could not be reached/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /try again/i }));
    expect(await within(dialog).findByText('SN-CL10-0005')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('changes nothing: it reads, and closing it gives the keyboard back to the shelf it was opened from', async () => {
    get.mockResolvedValueOnce(shelfOf(BINS[0]!, ITEMS));
    const user = userEvent.setup();
    renderFloor();
    const slot = screen.getByRole('button', { name: /BIN-AAAA1111/ });
    await user.click(slot);
    await screen.findByRole('dialog');
    // Nothing in the dialog but the way out.
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Close']);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(slot).toHaveFocus();
    expect(
      get.mock.calls.every(
        ([path]) => typeof path === 'string' && path.startsWith('/custody/bins/b1/items'),
      ),
    ).toBe(true);
  });

  it('is read in Hebrew in the same order, with its numbers left to right', async () => {
    localStorage.setItem('bault.locale', 'he');
    get.mockResolvedValueOnce(shelfOf(BINS[0]!, ITEMS));
    const user = userEvent.setup();
    renderFloor();
    await user.click(screen.getByRole('button', { name: /BIN-AAAA1111/ }));
    const dialog = await screen.findByRole('dialog', { name: 'BIN-AAAA1111' });
    expect(within(dialog).getByRole('region', { name: 'פריטים על המדף' })).toHaveTextContent('2');
    const rows = await within(dialog).findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('SN-CL10-0005');
    expect(within(rows[0]!).getByText('SN-CL10-0005')).toHaveAttribute('dir', 'ltr');
  });
});
