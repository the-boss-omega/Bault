import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { Serial, Amount, Code, Seal, LtrRun } = await import('../../apps/web/src/shared/ui/Serial');
const { StatusBadge } = await import('../../apps/web/src/shared/ui/primitives');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('the serial', () => {
  it('stays left-to-right and whole', () => {
    renderIn(<Serial value="SN-ROS105-0008" lead />);
    const el = screen.getByText('SN-ROS105-0008');

    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el).toHaveAttribute('translate', 'no');
    expect(el.className).toContain('serial');
    expect(el.textContent).toBe('SN-ROS105-0008');
  });
});

describe('an amount', () => {
  it('is isolated left-to-right, and names what it is for after itself', () => {
    renderIn(
      <Amount size="lead" what="Storage, Aug">
        $12.40
      </Amount>,
    );
    const figure = screen.getByText('$12.40');
    expect(figure).toHaveAttribute('dir', 'ltr');
    expect(figure.className).toContain('amount');

    const wrapper = figure.parentElement!;
    const order = [...wrapper.querySelectorAll('span')].map((n) => n.className);
    expect(order[0]).toContain('amount');
    expect(wrapper.textContent).toMatch(/^\$12\.40/);
    expect(wrapper.textContent).toContain('Storage, Aug');
  });

});

describe('a code that is not the subject', () => {
  it('is isolated', () => {
    renderIn(<Code value="BIN-XHMHPADV" />);
    const el = screen.getByText('BIN-XHMHPADV');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el).toHaveAttribute('translate', 'no');
    expect(el.className).toContain('code-inline');
  });
});

describe('a Latin run inside prose', () => {
  it('is marked as one', () => {
    const catalogue = '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo';
    renderIn(<LtrRun>{catalogue}</LtrRun>);
    const el = screen.getByText(catalogue);
    expect(el.className).toContain('ltr-run');
  });
});

describe('the status mark', () => {
  it('states the status in words as well as in colour', () => {
    renderIn(
      <>
        <StatusBadge tone="success">Stored</StatusBadge>
        <StatusBadge tone="warning">Pending</StatusBadge>
        <StatusBadge tone="error">Disputed</StatusBadge>
      </>,
    );
    for (const word of ['Stored', 'Pending', 'Disputed']) {
      expect(screen.getByText(word)).toBeInTheDocument();
    }
    expect(screen.getByText('Stored').className).toContain('pill--success');
    expect(screen.getByText('Pending').className).toContain('pill--warning');
    expect(screen.getByText('Disputed').className).toContain('pill--error');
  });

  it('is ONE component — `.pill` and `.badge` are not two systems', () => {
    renderIn(<StatusBadge tone="info">Listed</StatusBadge>);
    const el = screen.getByText('Listed');
    expect(el.className).toContain('pill');
    expect(el.className).not.toContain('badge');
  });
});

describe('the three item states', () => {
  function Row({ state }: { state: 'active' | 'frozen' | 'departed' }) {
    return (
      <li
        data-testid="row"
        className={[
          'card',
          'card--interactive',
          state === 'frozen' ? 'card--frozen' : '',
          state === 'departed' ? 'card--historical' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <h3 className="card-title">
          <Serial value="SN-ROS105-0008" lead />
        </h3>
        {state === 'frozen' && <span className="pill pill--frozen">Frozen</span>}
        {state === 'departed' && <span className="pill pill--departed">Departed</span>}
      </li>
    );
  }

  it('distinguishes active, frozen and departed', () => {
    const { unmount } = renderIn(<Row state="active" />);
    expect(screen.getByTestId('row').className).not.toContain('card--frozen');
    expect(screen.getByTestId('row').className).not.toContain('card--historical');
    unmount();

    const frozen = renderIn(<Row state="frozen" />);
    expect(screen.getByTestId('row').className).toContain('card--frozen');
    expect(within(screen.getByTestId('row')).getByText('Frozen')).toBeInTheDocument();
    frozen.unmount();

    renderIn(<Row state="departed" />);
    const row = screen.getByTestId('row');
    expect(row.className).toContain('card--historical');
    expect(within(row).getByText('SN-ROS105-0008')).toBeInTheDocument();
    expect(within(row).getByText('Departed')).toBeInTheDocument();
  });
});

describe('the seal', () => {
  it('is a claim Bault makes, not a label somebody applied', () => {
    renderIn(<Seal>Inspected</Seal>);
    const el = screen.getByText('Inspected').parentElement!;
    expect(el.className).toContain('seal');
    expect(el.className).not.toContain('pill');
  });
});
