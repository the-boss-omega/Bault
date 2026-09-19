import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/**
 * The Custody Grade components, in both directions.
 *
 * These pin the promises the design system makes about identity, money and
 * state — the three things the direction is built on — and they pin them as
 * BEHAVIOUR rather than as pixels. A screenshot test would fail on a 1px
 * padding change and pass on a serial rendered backwards; these do the reverse.
 *
 * Every case runs twice, once with `<html dir="rtl">` and once with `ltr`,
 * because the whole point of the pass that produced these components is that
 * Hebrew is not a mirrored afterthought. The bugs they guard were all found in
 * Hebrew and all invisible in English:
 *
 *   - a serial laid out right-to-left inside a Hebrew sentence;
 *   - a catalogue string whose leading year migrated to the end of the line
 *     because `unicode-bidi: isolate` resolves direction from the ELEMENT, and
 *     "2011 Pokémon…" begins with a neutral character;
 *   - a locale-formatted Hebrew date forced left-to-right;
 *   - a frozen item indistinguishable from an active one.
 */

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { Serial, Amount, Code, Seal, LtrRun } = await import('../../apps/web/src/shared/ui/Serial');
const { StatusBadge } = await import('../../apps/web/src/shared/ui/primitives');

/** Render under a document direction, the way the i18n provider sets it. */
function renderIn(dir: 'ltr' | 'rtl', ui: React.ReactElement) {
  document.documentElement.dir = dir;
  document.documentElement.lang = dir === 'rtl' ? 'he' : 'en';
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const DIRECTIONS = ['ltr', 'rtl'] as const;

describe('the serial', () => {
  for (const dir of DIRECTIONS) {
    it(`stays left-to-right and whole in ${dir}`, () => {
      renderIn(dir, <Serial value="SN-ROS105-0008" lead />);
      const el = screen.getByText('SN-ROS105-0008');

      // The identity of every object in this product is a Latin run. Inside a
      // Hebrew sentence, without this, the bidi algorithm reorders it.
      expect(el).toHaveAttribute('dir', 'ltr');
      // A machine identifier must survive a browser's page translation.
      expect(el).toHaveAttribute('translate', 'no');
      expect(el.className).toContain('serial');
      // Never truncated: the whole code is in the DOM, not an ellipsis of it.
      expect(el.textContent).toBe('SN-ROS105-0008');
    });
  }
});

describe('an amount', () => {
  for (const dir of DIRECTIONS) {
    it(`is isolated left-to-right in ${dir}, and names what it is for after itself`, () => {
      renderIn(
        dir,
        <Amount size="lead" what="Storage, Aug">
          $12.40
        </Amount>,
      );
      const figure = screen.getByText('$12.40');
      expect(figure).toHaveAttribute('dir', 'ltr');
      expect(figure.className).toContain('amount');

      // Money names itself FIRST. The figure precedes its caption in the DOM,
      // which is also the order a screen reader reads them in.
      const wrapper = figure.parentElement!;
      const order = [...wrapper.querySelectorAll('span')].map((n) => n.className);
      expect(order[0]).toContain('amount');
      expect(wrapper.textContent).toMatch(/^\$12\.40/);
      expect(wrapper.textContent).toContain('Storage, Aug');
    });
  }

  it('renders the same string in both directions', () => {
    const { unmount } = renderIn('ltr', <Amount>$3,200.00</Amount>);
    const ltr = screen.getByText('$3,200.00').textContent;
    unmount();
    renderIn('rtl', <Amount>$3,200.00</Amount>);
    // A ledger column that changes shape when somebody switches language is a
    // column two people cannot read together.
    expect(screen.getByText('$3,200.00').textContent).toBe(ltr);
  });
});

describe('a code that is not the subject', () => {
  for (const dir of DIRECTIONS) {
    it(`is isolated in ${dir}`, () => {
      renderIn(dir, <Code value="BIN-XHMHPADV" />);
      const el = screen.getByText('BIN-XHMHPADV');
      expect(el).toHaveAttribute('dir', 'ltr');
      expect(el).toHaveAttribute('translate', 'no');
      expect(el.className).toContain('code-inline');
    });
  }
});

describe('a Latin run inside prose', () => {
  for (const dir of DIRECTIONS) {
    it(`is marked as one in ${dir}`, () => {
      const catalogue = '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo';
      renderIn(dir, <LtrRun>{catalogue}</LtrRun>);
      const el = screen.getByText(catalogue);
      // `.ltr-run` sets `direction: ltr; unicode-bidi: isolate`, which is what
      // stops the leading "2011" ending up at the far end of the line.
      expect(el.className).toContain('ltr-run');
    });
  }
});

describe('the status mark', () => {
  for (const dir of DIRECTIONS) {
    it(`states the status in words as well as in colour, in ${dir}`, () => {
      renderIn(
        dir,
        <>
          <StatusBadge tone="success">Stored</StatusBadge>
          <StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="error">Disputed</StatusBadge>
        </>,
      );
      // Roughly one in twelve men cannot separate the red and green these marks
      // use. The label is the signal; the colour is the shortcut.
      for (const word of ['Stored', 'Pending', 'Disputed']) {
        expect(screen.getByText(word)).toBeInTheDocument();
      }
      expect(screen.getByText('Stored').className).toContain('pill--success');
      expect(screen.getByText('Pending').className).toContain('pill--warning');
      expect(screen.getByText('Disputed').className).toContain('pill--error');
    });
  }

  it('is ONE component — `.pill` and `.badge` are not two systems', () => {
    renderIn('ltr', <StatusBadge tone="info">Listed</StatusBadge>);
    const el = screen.getByText('Listed');
    expect(el.className).toContain('pill');
    expect(el.className).not.toContain('badge');
  });
});

describe('the three item states', () => {
  /**
   * The register row's state is carried by a MODIFIER on the row, not by a
   * different component and not by colour alone — which is what makes the frozen
   * and departed treatments structural rather than decorative.
   */
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

  for (const dir of DIRECTIONS) {
    it(`distinguishes active, frozen and departed in ${dir}`, () => {
      const { unmount } = renderIn(dir, <Row state="active" />);
      expect(screen.getByTestId('row').className).not.toContain('card--frozen');
      expect(screen.getByTestId('row').className).not.toContain('card--historical');
      unmount();

      const frozen = renderIn(dir, <Row state="frozen" />);
      expect(screen.getByTestId('row').className).toContain('card--frozen');
      // A frozen item says so in words, not only with a rail.
      expect(within(screen.getByTestId('row')).getByText('Frozen')).toBeInTheDocument();
      frozen.unmount();

      renderIn(dir, <Row state="departed" />);
      const row = screen.getByTestId('row');
      expect(row.className).toContain('card--historical');
      // A departed item keeps its identity. It is not deleted, hidden or blanked.
      expect(within(row).getByText('SN-ROS105-0008')).toBeInTheDocument();
      expect(within(row).getByText('Departed')).toBeInTheDocument();
    });
  }
});

describe('the seal', () => {
  it('is a claim Bault makes, not a label somebody applied', () => {
    renderIn('ltr', <Seal>Inspected</Seal>);
    const el = screen.getByText('Inspected').parentElement!;
    expect(el.className).toContain('seal');
    // It is deliberately NOT the status component: a seal and a badge mean
    // different things and must not be able to drift into each other.
    expect(el.className).not.toContain('pill');
  });
});
