import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The design system itself.
 *
 * These assert the behaviours the system PROMISES, as opposed to how it looks —
 * a screenshot test would pin the appearance and miss all of this. What a design
 * system is actually for is that a control behaves the same way everywhere: a
 * busy button cannot be pressed twice, a label focuses its field, a theme choice
 * survives a reload, and a failure says what went wrong.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  // `errorText` asks the module which failure this was.
  apiErrorKey: () => null,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ThemeProvider } = await import('../../apps/web/src/shared/theme');
const { Button, Field } = await import('../../apps/web/src/shared/ui/primitives');
const { ThemeToggle } = await import('../../apps/web/src/shared/ui/PageHeader');
const { ShelfYieldPanel } = await import('../../apps/web/src/areas/admin/ShelfYieldPanel');

function renderIn(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <I18nProvider>{ui}</I18nProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.removeItem('bault.theme');
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('a field and its label', () => {
  it('focuses the control when its caption is clicked', async () => {
    const user = userEvent.setup();
    renderIn(
      <Field label="Owner username" hint="As shown on the parcel." htmlFor="owner">
        <input id="owner" aria-describedby="owner-hint" />
      </Field>,
    );

    // The whole point of a real <label for>: the caption is a hit target for
    // the control, which a wrapping <label> around a <span> never provided.
    await user.click(screen.getByText('Owner username'));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('names the field by its caption alone, with the hint as a description', () => {
    renderIn(
      <Field label="Owner username" hint="As shown on the parcel." htmlFor="owner">
        <input id="owner" aria-describedby="owner-hint" />
      </Field>,
    );

    // Previously the accessible name was the caption and the hint run together,
    // so a screen reader announced the help text as part of the field's name.
    expect(screen.getByLabelText('Owner username')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription('As shown on the parcel.');
  });

  it('replaces the hint with the error, and announces it', () => {
    renderIn(
      <Field label="Amount" hint="Minimum $10." error="That is below the minimum." htmlFor="amt">
        <input id="amt" aria-invalid="true" />
      </Field>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('That is below the minimum.');
    // The hint is gone rather than stacked under the error — two messages about
    // one field, one of them now wrong, is worse than one.
    expect(screen.queryByText('Minimum $10.')).not.toBeInTheDocument();
  });
});

describe('a button that is working', () => {
  it('cannot be pressed twice', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderIn(
      <Button loading onClick={onClick}>
        Pay now
      </Button>,
    );

    const button = screen.getByRole('button', { name: /pay now/i });
    // A form whose only feedback is that nothing happens gets pressed again,
    // and on a money-moving action that is a real problem.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy when it is merely disabled', () => {
    renderIn(<Button disabled>Pay now</Button>);
    const button = screen.getByRole('button', { name: /pay now/i });
    expect(button).toBeDisabled();
    // "You cannot do this yet" and "I am doing this" are different states and
    // must not announce identically.
    expect(button).not.toHaveAttribute('aria-busy');
  });
});

describe('the theme', () => {
  it('follows the system by default, stamping nothing', () => {
    renderIn(<ThemeToggle />);
    // `system` is a real preference, not an absence of one — and it works by
    // leaving the media query to decide, which means no attribute at all.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('cycles light → dark → system on one control', async () => {
    const user = userEvent.setup();
    renderIn(<ThemeToggle />);
    const toggle = screen.getByRole('button');

    await user.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(toggle);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('remembers the choice', async () => {
    const user = userEvent.setup();
    renderIn(<ThemeToggle />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('button'));
    expect(localStorage.getItem('bault.theme')).toBe('dark');
  });

  it('says which theme is on, so the control is not a mystery', () => {
    localStorage.setItem('bault.theme', 'dark');
    renderIn(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/dark/i);
  });
});

describe('shelf yield', () => {
  const YIELD = {
    shelves: [
      {
        binId: 'b1', serialNumber: 'BIN-AAAA1111', zone: 'A', facilityCode: 'NJ',
        oversized: false, active: true, itemCount: 40, slotDays: 1200,
        revenueMinor: 500, revenuePerSlotMonthMinor: 12, deadItemCount: 38, oldestItemDays: 400,
      },
      {
        binId: 'b2', serialNumber: 'BIN-BBBB2222', zone: 'B', facilityCode: 'NJ',
        oversized: false, active: true, itemCount: 6, slotDays: 180,
        revenueMinor: 40_000, revenuePerSlotMonthMinor: 6_666, deadItemCount: 0, oldestItemDays: 30,
      },
      {
        binId: 'b3', serialNumber: 'BIN-CCCC3333', zone: 'O', facilityCode: 'NJ',
        oversized: true, active: true, itemCount: 0, slotDays: 0,
        revenueMinor: 0, revenuePerSlotMonthMinor: null, deadItemCount: 0, oldestItemDays: null,
      },
    ],
    totals: {
      shelfCount: 3, occupiedShelfCount: 2, emptyShelfCount: 1,
      itemCount: 46, deadItemCount: 38, revenueMinor: 40_500, slotDays: 1380,
    },
  };

  function mockYield() {
    get.mockImplementation((path: string) => {
      if (path === '/admin/shelf-yield') return Promise.resolve(YIELD);
      if (path.endsWith('/zones')) {
        return Promise.resolve([
          { zone: 'NJ / A', shelfCount: 1, occupiedShelfCount: 1, itemCount: 40, deadItemCount: 38, revenueMinor: 500, revenuePerSlotMonthMinor: 12 },
        ]);
      }
      return Promise.resolve([
        { userId: 'u1', username: 'red', itemCount: 40, slotDays: 1200, revenueMinor: 500, revenuePerSlotMonthMinor: 12, deadItemCount: 38 },
      ]);
    });
  }

  it('puts the worst-earning shelf where the eye lands first', async () => {
    mockYield();
    renderIn(<ShelfYieldPanel />);

    // Three tables render — shelves, zones, customers. The first is the one
    // this assertion is about.
    await screen.findByText('BIN-AAAA1111');
    const table = screen.getAllByRole('table')[0]!;
    const rows = within(table).getAllByRole('row').slice(1); // drop the header
    // The job this screen exists for is "find the shelf to reclaim", so the
    // answer has to be the first row, not somewhere in the middle.
    expect(within(rows[0]!).getByText('BIN-AAAA1111')).toBeInTheDocument();
  });

  it('leaves empty shelves out of the table — an empty shelf is capacity, not a problem', async () => {
    mockYield();
    renderIn(<ShelfYieldPanel />);
    await screen.findByText('BIN-AAAA1111');
    expect(screen.queryByText('BIN-CCCC3333')).not.toBeInTheDocument();
    // It is still counted, in the metric where it means something good.
    expect(screen.getByText(/1 empty and available/i)).toBeInTheDocument();
  });

  it('flags the shelf full of items earning nothing', async () => {
    mockYield();
    renderIn(<ShelfYieldPanel />);
    await screen.findByText('BIN-AAAA1111');
    expect(screen.getAllByText(/38 earning nothing/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/earning/i).length).toBeGreaterThan(0);
  });

  it('says revenue, never profit', async () => {
    mockYield();
    renderIn(<ShelfYieldPanel />);
    await screen.findByText('BIN-AAAA1111');
    // Rent, labour and insurance are not in this database, so a margin figure
    // would be a confident number about something nobody measured.
    // The caveat is stated where the money is, not buried in a footnote.
    expect(screen.getByText(/revenue, not profit/i)).toBeInTheDocument();
    // …and "profit" appears ONLY inside that disclaimer — never as a column
    // header or a metric label, which would be the claim it disclaims.
    const profitMentions = screen
      .queryAllByText(/profit/i)
      .filter((el) => !/revenue, not profit/i.test(el.textContent ?? ''));
    expect(profitMentions).toEqual([]);
  });

  it('shows a skeleton while it loads, not an empty table', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderIn(<ShelfYieldPanel />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the reason it could not load, with a way to retry', async () => {
    get.mockRejectedValue(new Error('The report is unavailable.'));
    renderIn(<ShelfYieldPanel />);
    expect(await screen.findByText(/report is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
