import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { I18nProvider, useI18n } = await import('../../apps/web/src/shared/i18n');
const { StatementSlip, InTransit } = await import('../../apps/web/src/areas/customer/finance/StatementSlip');
const { ShelfMap } = await import('../../apps/web/src/areas/warehouse/ShelfMap');
const { ItemPick } = await import('../../apps/web/src/shared/ui/Serial');

/** Renders a component that needs the translator, in English. */
function WithT({ children }: { children: (t: ReturnType<typeof useI18n>['t']) => React.ReactNode }) {
  const { t } = useI18n();
  return <>{children(t)}</>;
}

function renderT(children: (t: ReturnType<typeof useI18n>['t']) => React.ReactNode) {
  return render(
    <I18nProvider>
      <WithT>{children}</WithT>
    </I18nProvider>,
  );
}

describe('the wallet statement', () => {
  const flows = { inflow: 1_000_000, outflow: 30_000, count: 8 };

  it('names the balance and lays the ledger out as the sum it is', () => {
    renderT((t) => <StatementSlip amount={970_000} flows={flows} expanded t={t} />);

    const slip = screen.getByRole('region', { name: 'Current balance' });
    expect(within(slip).getByText('$9,700.00', { selector: 'p span span' })).toBeInTheDocument();

    // credited, less debited, equals net: the four figures the statistics showed, under their names.
    expect(within(slip).getByText('Total credited').nextElementSibling).toHaveTextContent('$10,000.00');
    expect(within(slip).getByText('Total debited').nextElementSibling).toHaveTextContent('$300.00');
    expect(within(slip).getByText('Net movement').nextElementSibling).toHaveTextContent('$9,700.00');
    expect(within(slip).getByText('Transactions').nextElementSibling).toHaveTextContent('8');
  });

  it('isolates each figure left to right inside a cell that reads the page’s way, so it hangs from its name’s edge', () => {
    renderT((t) => <StatementSlip amount={970_000} flows={flows} expanded t={t} />);

    for (const name of ['Total credited', 'Total debited', 'Net movement']) {
      const cell = screen.getByText(name).nextElementSibling!;
      expect(cell).not.toHaveAttribute('dir');
      expect(cell.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    }
  });

  it('keeps the slip short on the other tabs: the balance, without the sum', () => {
    renderT((t) => <StatementSlip amount={970_000} flows={flows} expanded={false} t={t} />);

    expect(screen.getByText('Current balance')).toBeInTheDocument();
    expect(screen.queryByText('Total credited')).not.toBeInTheDocument();
    expect(screen.queryByText('Net movement')).not.toBeInTheDocument();
  });

  it('draws its stub as decoration only, with no text for a screen reader', () => {
    const { container } = renderT((t) => <StatementSlip amount={0} flows={flows} expanded t={t} />);
    const stub = container.querySelector('.statement-stub');
    expect(stub).toHaveAttribute('aria-hidden', 'true');
    expect(stub?.textContent).toBe('');
  });

  it('shows money that has been asked for and not moved as two slips and one sentence', () => {
    renderT((t) => <InTransit cashIn={25_000} cashOut={0} t={t} />);

    expect(screen.getByText('Cash in pending').nextElementSibling).toHaveTextContent('$250.00');
    expect(screen.getByText('Cash out pending').nextElementSibling).toHaveTextContent('$0.00');
    expect(screen.getByText(/requested but not yet approved/i)).toBeInTheDocument();
  });
});

describe('the warehouse shelf map', () => {
  const bins = [
    { id: 'b1', barcode: 'BIN-AAAA1111', zone: 'A', oversized: false, active: true, itemCount: 99 },
    { id: 'b2', barcode: 'BIN-AAAA2222', zone: 'A', oversized: false, active: true, itemCount: 0 },
    { id: 'b3', barcode: 'BIN-BBBB3333', zone: 'B', oversized: true, active: true, itemCount: 0 },
    { id: 'b4', barcode: 'BIN-BBBB4444', zone: 'B', oversized: false, active: false, itemCount: 0 },
  ];
  const counts = [
    { key: 'b1', count: 3 },
    { key: 'b2', count: 0 },
    { key: null, count: 2 },
  ];

  it('groups shelves by zone, in order, with the zone total', () => {
    renderT((t) => <ShelfMap bins={bins} counts={counts} t={t} />);

    const zoneA = screen.getByRole('region', { name: 'Zone A' });
    expect(within(zoneA).getAllByRole('listitem')).toHaveLength(2);
    expect(within(zoneA).getByText('3', { selector: '.shelf-zone-total' })).toBeInTheDocument();

    const zoneB = screen.getByRole('region', { name: 'Zone B' });
    expect(within(zoneB).getAllByRole('listitem')).toHaveLength(2);
  });

  it('takes a shelf’s count from the shelf report, not from the bin record', () => {
    renderT((t) => <ShelfMap bins={bins} counts={counts} t={t} />);

    const slot = screen.getByText('BIN-AAAA1111').closest('li')!;
    expect(within(slot).getByText('3', { selector: '.shelf-count' })).toBeInTheDocument();
    expect(slot).toHaveAttribute('data-state', 'stocked');
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  it('says in words when a shelf is empty, out of service or oversized, as well as drawing it', () => {
    renderT((t) => <ShelfMap bins={bins} counts={counts} t={t} />);

    const empty = screen.getByText('BIN-AAAA2222').closest('li')!;
    expect(empty).toHaveAttribute('data-state', 'empty');
    expect(empty).toHaveTextContent(/empty/i);

    const out = screen.getByText('BIN-BBBB4444').closest('li')!;
    expect(out).toHaveAttribute('data-state', 'out');
    expect(out).toHaveTextContent(/out of service/i);

    const wide = screen.getByText('BIN-BBBB3333').closest('li')!;
    expect(wide).toHaveAttribute('data-wide', 'true');
    expect(wide).toHaveTextContent(/oversized/i);
  });

  it('puts items that are on no shelf on a tray of their own', () => {
    renderT((t) => <ShelfMap bins={bins} counts={counts} t={t} />);

    const tray = screen.getByRole('region', { name: 'Unshelved' });
    expect(within(tray).getByText('2', { selector: '.shelf-zone-total' })).toBeInTheDocument();
  });

  it('shows no tray when everything is on a shelf', () => {
    renderT((t) => <ShelfMap bins={bins} counts={[{ key: 'b1', count: 1 }]} t={t} />);
    expect(screen.queryByRole('region', { name: 'Unshelved' })).not.toBeInTheDocument();
  });

  it('marks each item, up to a dozen, and counts the rest', () => {
    const { container } = renderT((t) => (
      <ShelfMap bins={[bins[0]!]} counts={[{ key: 'b1', count: 15 }]} t={t} />
    ));
    expect(container.querySelectorAll('.shelf-pip')).toHaveLength(12);
    expect(container.querySelector('.shelf-more')).toHaveTextContent('+3');
    expect(screen.getByText('15', { selector: '.shelf-count' })).toBeInTheDocument();
  });

  it('keeps a barcode left to right inside whichever direction its slot reads', () => {
    renderT((t) => <ShelfMap bins={bins} counts={counts} t={t} />);
    const barcode = screen.getByText('BIN-AAAA1111');
    expect(barcode.tagName).toBe('BDI');
    expect(barcode).toHaveAttribute('dir', 'ltr');
  });
});

describe('choosing cards', () => {
  it('shows the card in its case, and the control is still named by its serial and its name', () => {
    const { container } = renderT(() => (
      <ul className="check-list">
        <li>
          <label className="check">
            <input type="checkbox" />
            <ItemPick serial="SN-DX107-0003" name="2005 Pokémon EX Deoxys" />
          </label>
        </li>
      </ul>
    ));

    expect(screen.getByRole('checkbox', { name: 'SN-DX107-0003 2005 Pokémon EX Deoxys' })).toBeInTheDocument();
    const art = container.querySelector('.item-pick-art > .photo-thumb');
    // A label holds phrasing content, and the photograph adds nothing to what the control is called.
    expect(art?.tagName).toBe('SPAN');
    expect(art).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the serial left to right whatever the page reads', () => {
    renderT(() => <ItemPick serial="SN-DX107-0003" name="2005 Pokémon EX Deoxys" />);
    expect(screen.getByText('SN-DX107-0003')).toHaveAttribute('dir', 'ltr');
  });

  it('is only words for something with no serial', () => {
    const { container } = renderT(() => <ItemPick serial={null} name="A card on its way" />);
    expect(container.querySelector('.item-pick-art')).toBeNull();
    expect(screen.getByText('A card on its way')).toBeInTheDocument();
  });
});
