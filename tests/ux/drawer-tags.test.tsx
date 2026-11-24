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

describe('a tag on its own, and a tag in a list', () => {
  it('is a region of the page, named by its kicker, on its own; and an article, named the same way, in a list', () => {
    render(
      <I18nProvider>
        <DrawerTag kicker="On its own" title="One" />
        <ul>
          <li>
            <DrawerTag item kicker="First" title="One" />
          </li>
          <li>
            <DrawerTag item kicker="Second" title="Two" />
          </li>
        </ul>
      </I18nProvider>,
    );
    expect(screen.getByRole('region', { name: 'On its own' })).toBeInTheDocument();
    // A list of forty is not forty landmarks: none of these is one.
    expect(screen.getByRole('article', { name: 'First' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Second' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'First' })).toBeNull();
    expect(screen.queryAllByRole('region')).toHaveLength(1);
  });
});

const DEAL = {
  id: 'd1',
  code: 'ESC-H8RAZJYW',
  raiserRole: 'seller',
  myRole: 'buyer',
  raisedByMe: false,
  counterpartyIsMember: true,
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
  inspectedAt: null,
  inspectionMatches: null,
  inspectionNotes: null,
  buyerReleasedAt: null,
  sellerReleasedAt: null,
  closeReason: null,
  createdAt: '2026-10-21T12:00:00Z',
};

const EVENTS = [
  { eventType: 'item_received', fromStatus: null, toStatus: null, byStaff: false, notes: 'Card received at NJ and logged in.', occurredAt: '2026-10-26T12:00:00Z' },
  { eventType: 'funded', fromStatus: null, toStatus: null, byStaff: false, notes: 'Held from the buyer wallet.', occurredAt: '2026-10-24T12:00:00Z' },
  { eventType: 'agreed', fromStatus: null, toStatus: null, byStaff: true, notes: null, occurredAt: '2026-10-22T12:00:00Z' },
  { eventType: 'raised', fromStatus: null, toStatus: null, byStaff: false, notes: 'Seller raised the deal.', occurredAt: '2026-10-21T12:00:00Z' },
];

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  get.mockImplementation((path: string) => {
    if (path === '/escrow/mine') return Promise.resolve([DEAL]);
    if (path === '/escrow/terms') return Promise.resolve({ feeBps: 100, minimumFeeMinor: 2500, minimumValueMinor: 50000 });
    if (path === '/escrow/held') return Promise.resolve({ heldMinor: 0 });
    if (path === '/escrow/d1') return Promise.resolve({ deal: DEAL, events: EVENTS });
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
        <EscrowTab />
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('row', { name: /ESC-H8RAZJYW/ }));
    const dialog = await screen.findByRole('dialog');

    const tag = within(dialog).getByRole('region', { name: 'Value' });
    expect(within(tag).getByText('$1,450.00')).toBeInTheDocument();
    expect(within(tag).getByText('Being inspected')).toBeInTheDocument();
    expect(within(tag).getByText('Escrow fee $25.00')).toBeInTheDocument();

    const trail = within(dialog).getByRole('heading', { name: 'What happened' }).nextElementSibling as HTMLElement;
    const entries = within(trail).getAllByRole('listitem');
    expect(entries.map((e) => e.querySelector('.register-kind')!.textContent)).toEqual([
      'Card Embassy has the collectible and is inspecting it.',
      'Funds held',
      'Terms agreed',
      'Proposed',
    ]);
    // What the server wrote beside each is its own island.
    expect(within(entries[0]!).getByText('Card received at NJ and logged in.').tagName).toBe('BDI');
    expect(dialog).not.toHaveTextContent('recorded for them');
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

  it('uses the words for the states and the steps the product already has', () => {
    const { container } = render(
      <I18nProvider>
        <Labels types={['raised', 'agreed', 'funded', 'settled', 'returned', 'cancelled']} />
      </I18nProvider>,
    );
    const words = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(words).toEqual(['Proposed', 'Terms agreed', 'Funds held', 'Settled', 'Returned', 'Cancelled']);
  });

  it('says whether the inspection passed, and shows what it does not know as it was recorded', () => {
    const { container, rerender } = render(
      <I18nProvider>
        <Labels types={['inspected']} matches="yes" />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('Card Embassy inspected it, and it matches the description.');

    rerender(
      <I18nProvider>
        <Labels types={['inspected']} matches="no" />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('Card Embassy inspected it, and it does not match the description.');

    rerender(
      <I18nProvider>
        <Labels types={['released_by_buyer', 'a_new_thing']} />
      </I18nProvider>,
    );
    expect(container.textContent).toBe('released by buyera new thing');
  });
});
