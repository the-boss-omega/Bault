import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { isolate, isolateLtr } = await import('../../apps/web/src/shared/money');
const { ErrorState, Field } = await import('../../apps/web/src/shared/ui/primitives');
const { HouseStoreSection } = await import('../../apps/web/src/areas/admin/HouseStoreSection');
const { RemoveCommonsPanel } = await import('../../apps/web/src/areas/customer/vault/RemoveCommonsPanel');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function inHebrew(ui: React.ReactElement) {
  localStorage.setItem('bault.locale', 'he');
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
});

describe('a name or a figure set into a sentence keeps its own order', () => {
  it('isolate() is a first-strong isolate, and isolateLtr() a left-to-right one', () => {
    expect(isolate('2011 Pokémon Call of Legends')).toBe('⁨2011 Pokémon Call of Legends⁩');
    expect(isolateLtr('$39.00')).toBe('⁦$39.00⁩');
  });

  it('both are invisible: what they wrap is read back unchanged once the marks are taken out', () => {
    const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');
    expect(strip(isolate('Rayquaza (Gold Star)'))).toBe('Rayquaza (Gold Star)');
    expect(strip(isolateLtr('-$20.00'))).toBe('-$20.00');
  });
});

describe('what the server wrote is its own island on a page that reads the other way', () => {
  it('an error box sets the sentence in a <bdi>, so an English sentence keeps its full stop', () => {
    inHebrew(<ErrorState message="Password must be at least 8 characters." />);

    const sentence = screen.getByText('Password must be at least 8 characters.');
    expect(sentence.tagName).toBe('BDI');
    expect(sentence).toHaveAttribute('dir', 'auto');
  });

  it("a field's error is the same", () => {
    inHebrew(
      <Field label="Email" error="Enter a valid email address.">
        <input />
      </Field>,
    );

    const sentence = screen.getByText('Enter a valid email address.');
    expect(sentence.tagName).toBe('BDI');
    expect(sentence).toHaveAttribute('dir', 'auto');
    expect(sentence.closest('[role="alert"]')).not.toBeNull();
  });
});

describe('the admin house store', () => {
  it('sets a description beside its photo button in its own island, so the cell is not read as a button', async () => {
    get.mockResolvedValue([
      {
        id: 'h1',
        code: 'HSE-72WWGK6N',
        typeClass: 'trading_card',
        description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95',
        conditionGrade: 'NM',
        photoRef: 'SN-CL10-0005',
        askingPrice: 3500,
        stock: 3,
        status: 'active',
      },
    ]);
    inHebrew(<HouseStoreSection onMsg={() => {}} onError={() => {}} />);

    const description = await screen.findByText('2011 Pokémon Call of Legends — Rayquaza #SL10/95');
    expect(description.tagName).toBe('BDI');
    expect(description).toHaveAttribute('dir', 'auto');
    // The cell that holds the button holds the words too: this is the cell a table rule that sets a
    // cell with a button in it to the page's direction once scrambled ("… Hotta · 2011").
    const cell = description.closest('td')!;
    expect(within(cell).getByRole('button')).toBeInTheDocument();
  });
});

describe('removing commons', () => {
  const items = [
    {
      id: 'a',
      serialNumber: 'SN-CL10-0005',
      typeClass: 'trading_card',
      description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95',
      lifecycleState: 'stored',
      receivedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
    {
      id: 'b',
      serialNumber: 'SN-DX107-0003',
      typeClass: 'trading_card',
      description: '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star)',
      lifecycleState: 'listed',
      receivedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
  ];

  it('sets each name and each serial in an island of its own', () => {
    inHebrew(<RemoveCommonsPanel items={items} windowDays={30} onDone={() => {}} onError={() => {}} />);

    const name = screen.getByText('2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star)');
    expect(name.tagName).toBe('BDI');
    expect(name).toHaveAttribute('dir', 'auto');
    const serial = screen.getByText('SN-DX107-0003');
    expect(serial.tagName).toBe('BDI');
    expect(serial).toHaveAttribute('dir', 'ltr');
  });

  it('keeps the reason a card cannot be chosen beside its choice, in a row that lays them out with a gap', () => {
    inHebrew(<RemoveCommonsPanel items={items} windowDays={30} onDone={() => {}} onError={() => {}} />);

    const blocked = screen.getByRole('checkbox', { name: /Deoxys/ });
    expect(blocked).toBeDisabled();
    const row = blocked.closest('li')!;
    expect(row).toHaveClass('check-row');
    // The reason is the row's, not the label's: set against the end of the label it had no gap from its date.
    const reason = within(row).getByText('לא מאוחסן');
    expect(blocked.closest('label')!.contains(reason)).toBe(false);
  });
});
