import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { DrawerTag } = await import('../../apps/web/src/shared/ui/DrawerTag');
const { EscrowTab } = await import('../../apps/web/src/areas/customer/marketplace/EscrowTab');
const { escrowEventLabel } = await import('../../apps/web/src/shared/escrow');
const { I18nProvider, useT } = await import('../../apps/web/src/shared/i18n');

const DEAL = {
  id: 'd1',
  code: 'ESC-H8RAZJYW',
  raisedBy: 'u2',
  raiserRole: 'seller',
  counterpartyUserId: 'u1',
  counterpartyName: null,
  counterpartyEmail: null,
  description: 'A second copy of the 2003 Pokémon EX Dragon — Rayquaza ex #97/97.',
  valueMinor: 145000,
  feeMinor: 2500,
  currency: 'USD',
  status: 'inspecting',
  settlement: 'buyer_vault',
  fundingSource: 'wallet',
  fundedAt: '2026-10-24T12:00:00Z',
  fundingReference: null,
  itemId: null,
  inspectedAt: null,
  inspectionMatches: null,
  inspectionNotes: null,
  buyerReleasedAt: null,
  buyerReleaseAttestedBy: null,
  sellerReleasedAt: null,
  sellerReleaseAttestedBy: null,
  closeReason: null,
  createdAt: '2026-10-21T12:00:00Z',
};

const EVENTS = [
  { id: 'e4', eventType: 'item_received', fromStatus: null, toStatus: null, actorId: null, onBehalfOf: null, notes: 'Card received at NJ and logged in.', occurredAt: '2026-10-26T12:00:00Z' },
  { id: 'e3', eventType: 'funded', fromStatus: null, toStatus: null, actorId: null, onBehalfOf: null, notes: 'Held from the buyer wallet.', occurredAt: '2026-10-24T12:00:00Z' },
  { id: 'e2', eventType: 'agreed', fromStatus: null, toStatus: null, actorId: null, onBehalfOf: 'u2', notes: null, occurredAt: '2026-10-22T12:00:00Z' },
  { id: 'e1', eventType: 'raised', fromStatus: null, toStatus: null, actorId: null, onBehalfOf: null, notes: 'Seller raised the deal.', occurredAt: '2026-10-21T12:00:00Z' },
];

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  // The product opens in Hebrew; these read it in English unless a test says otherwise.
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation((path: string) => {
    if (path === '/escrow/mine') return Promise.resolve([DEAL]);
    if (path === '/escrow/terms') return Promise.resolve({ feeBps: 100, minimumFeeMinor: 2500, minimumValueMinor: 50000 });
    if (path === '/escrow/held') return Promise.resolve({ heldMinor: 0 });
    if (path === '/escrow/d1') return Promise.resolve({ deal: DEAL, events: EVENTS, buyerId: 'u1', sellerId: 'u2' });
    return Promise.resolve([]);
  });
});

describe('a drawer opens on the sum it is about', () => {
  it('the tag names the amount, writes it left to right in the display face, and says where it stands', () => {
    render(
      <I18nProvider>
        <DrawerTag kicker="Value" amount="$1,450.00" status={<span>Being inspected</span>} note="Fee $25.00" />
      </I18nProvider>,
    );

    const tag = screen.getByRole('region', { name: 'Value' });
    const amount = within(tag).getByText('$1,450.00');
    expect(amount).toHaveClass('amount');
    expect(amount).toHaveAttribute('dir', 'ltr');
    expect(within(tag).getByText('Being inspected')).toBeInTheDocument();
    expect(within(tag).getByText('Fee $25.00')).toBeInTheDocument();
  });

  it('is only the amount when there is nothing to say about it', () => {
    const { container } = render(
      <I18nProvider>
        <DrawerTag kicker="Amount" amount="-$5.00" />
      </I18nProvider>,
    );

    expect(container.querySelector('.drawer-tag-foot')).toBeNull();
  });

  it('an escrow deal opens on its value, with the state under it and the history in the product’s own words', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <EscrowTab meId="u1" />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('row', { name: /ESC-H8RAZJYW/ }));
    const dialog = await screen.findByRole('dialog');

    const tag = within(dialog).getByRole('region', { name: 'Value' });
    expect(within(tag).getByText('$1,450.00')).toBeInTheDocument();
    expect(within(tag).getByText('Being inspected')).toBeInTheDocument();
    expect(within(tag).getByText('Fee $25.00')).toBeInTheDocument();

    const trail = within(dialog).getByRole('heading', { name: 'What happened' }).nextElementSibling as HTMLElement;
    const entries = within(trail).getAllByRole('listitem');
    expect(entries.map((e) => e.querySelector('.register-kind')!.textContent)).toEqual([
      'It is with us and waiting to be looked at.',
      'Funds held',
      'Terms agreed',
      'Proposed',
    ]);
    // What the server wrote beside each is its own island.
    expect(within(entries[0]!).getByText('Card received at NJ and logged in.').tagName).toBe('BDI');
    // And a step recorded on someone's behalf says so.
    expect(within(entries[2]!).getByText('recorded for them')).toBeInTheDocument();
  });
});

describe('what a deal’s history says', () => {
  function Labels({ types, matches = null }: { types: string[]; matches?: string | null }) {
    const t = useT();
    return (
      <ul>
        {types.map((type) => (
          <li key={type}>{escrowEventLabel(t, { eventType: type }, { inspectionMatches: matches })}</li>
        ))}
      </ul>
    );
  }

  it('uses the words for the states and the steps the product already has, in the page’s language', () => {
    localStorage.setItem('bault.locale', 'he');
    const { container } = render(
      <I18nProvider>
        <Labels types={['raised', 'agreed', 'funded', 'settled', 'returned', 'cancelled']} />
      </I18nProvider>,
    );
    const words = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(words).toEqual(['הוצעה', 'סוכמה', 'הכסף מוחזק', 'הושלמה', 'הוחזרה', 'בוטלה']);
  });

  it('says whether the inspection passed, and shows what it does not know as it was recorded', () => {
    const { container, rerender } = render(
      <I18nProvider>
        <Labels types={['inspected']} matches="yes" />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('We looked at it and it matches the description.');

    rerender(
      <I18nProvider>
        <Labels types={['inspected']} matches="no" />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('We looked at it and it does NOT match the description.');

    rerender(
      <I18nProvider>
        <Labels types={['released_by_buyer', 'a_new_thing']} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('released by buyera new thing');
  });
});
