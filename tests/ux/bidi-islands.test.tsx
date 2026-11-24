import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { isolate } = await import('../../apps/web/src/shared/money');
const { ErrorState, Field } = await import('../../apps/web/src/shared/ui/primitives');
const { HouseStoreSection } = await import('../../apps/web/src/areas/admin/HouseStoreSection');
const { RemoveCommonsPanel } = await import('../../apps/web/src/areas/customer/vault/RemoveCommonsPanel');
const { ServiceQueue } = await import('../../apps/web/src/areas/warehouse/ServiceQueue');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function inPage(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
});

describe('a name set into a sentence keeps its own order', () => {
  it('isolate() is a first-strong isolate', () => {
    expect(isolate('2011 Pokémon Call of Legends')).toBe('⁨2011 Pokémon Call of Legends⁩');
  });

  it('is invisible: what it wraps is read back unchanged once the marks are taken out', () => {
    expect(isolate('Rayquaza (Gold Star)').replace(/[⁨⁩]/g, '')).toBe('Rayquaza (Gold Star)');
  });
});

describe('what the server wrote is its own island', () => {
  it('an error box sets the sentence in a <bdi>, so an English sentence keeps its full stop', () => {
    inPage(<ErrorState message="Password must be at least 8 characters." />);

    const sentence = screen.getByText('Password must be at least 8 characters.');
    expect(sentence.tagName).toBe('BDI');
    expect(sentence).toHaveAttribute('dir', 'auto');
  });

  it("a field's error is the same", () => {
    inPage(
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
  it('sets a description in its own island, so a name keeps its own order whatever script it is typed in', async () => {
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
    inPage(<HouseStoreSection onMsg={() => {}} onError={() => {}} />);

    const description = await screen.findByText('2011 Pokémon Call of Legends — Rayquaza #SL10/95');
    expect(description.tagName).toBe('BDI');
    expect(description).toHaveAttribute('dir', 'auto');
    // The name is the headline of the product's tag, and the card's photograph is a button of its own beside it:
    // the words and the button are not one run of text (once a table cell that held both read "… Hotta · 2011").
    const tag = description.closest('.drawer-tag')!;
    expect(within(tag as HTMLElement).getByRole('button', { name: /show photo/i })).toBeInTheDocument();
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
    inPage(<RemoveCommonsPanel items={items} windowDays={30} onDone={() => {}} onError={() => {}} />);

    const name = screen.getByText('2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star)');
    expect(name.tagName).toBe('BDI');
    expect(name).toHaveAttribute('dir', 'auto');
    const serial = screen.getByText('SN-DX107-0003');
    expect(serial.tagName).toBe('BDI');
    expect(serial).toHaveAttribute('dir', 'ltr');
  });

  it('keeps the reason a card cannot be chosen beside its choice, in a row that lays them out with a gap', () => {
    inPage(<RemoveCommonsPanel items={items} windowDays={30} onDone={() => {}} onError={() => {}} />);

    const blocked = screen.getByRole('checkbox', { name: /Deoxys/ });
    expect(blocked).toBeDisabled();
    const row = blocked.closest('li')!;
    expect(row).toHaveClass('check-row');
    // The reason is the row's, not the label's: set against the end of the label it had no gap from its date.
    const reason = within(row).getByText('Not stored');
    expect(blocked.closest('label')!.contains(reason)).toBe(false);
  });
});

describe('what a customer wrote in a request for a service', () => {
  it('is a block of its own in the warehouse queue, so the sentence keeps its full stop at its end', async () => {
    get.mockImplementation(async (path: string) =>
      path === '/services/queue'
        ? [
            {
              id: 'r1',
              code: 'SR-1',
              type: 'custom',
              status: 'accepted',
              itemId: null,
              requesterEmail: 'red@bault.dev',
              itemDescription: null,
              typeFields: {
                summary: 'Photograph the back under raking light',
                detail: 'Two additional photographs of the reverse. No handling out of the sleeve.',
              },
            },
          ]
        : [],
    );
    inPage(<ServiceQueue />);
    const detail = await screen.findByText('Two additional photographs of the reverse. No handling out of the sleeve.');
    // `unicode-bidi: plaintext` on a block (the stylesheet hangs it from the page's edge): not a run inside a line that reads the page's way.
    expect(detail).toHaveClass('bidi', 'ask-line');
    expect(screen.getByText('Photograph the back under raking light')).toHaveClass('bidi', 'ask-line');
  });
});
