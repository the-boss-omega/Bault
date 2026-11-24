import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    put: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { NotificationsPage } = await import('../../apps/web/src/areas/customer/notifications/NotificationsPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const note = (id: string, eventType: string, content: unknown, createdAt: string) => ({
  id,
  eventType,
  content,
  createdAt,
});

function feedOf(items: unknown[], loading = false) {
  return { items, error: null, loading, reload: vi.fn(), unseen: 0, markSeen: vi.fn() } as never;
}

/** The page also loads its preferences; let that settle, so nothing updates after the test has looked. */
async function renderFeed(items: unknown[], loading = false) {
  get.mockResolvedValue({ categories: [], channels: [], events: [] });
  window.location.hash = '#/notifications';
  const view = render(
    <I18nProvider>
      <NotificationsPage feed={feedOf(items, loading)} onSeen={() => {}} />
    </I18nProvider>,
  );
  await act(async () => {});
  return view;
}

beforeEach(() => {
  get.mockReset();
});

describe('the notifications, a register', () => {
  // Midday in UTC, so that a day is the same day wherever the test runs.
  const items = [
    note('n1', 'offer_received', { message: 'You received an offer of $2,750.00.' }, '2026-10-27T12:00:00.000Z'),
    note('n2', 'item_received', { barcode: 'SN-DR97-0001', message: 'Item SN-DR97-0001 was received into your vault.' }, '2026-10-27T12:30:00.000Z'),
    note('n3', 'wallet_request_completed', { message: 'Your cash-in was approved.' }, '2026-10-25T12:00:00.000Z'),
  ];

  const entriesOf = (list: HTMLElement) => within(list).getAllByRole('listitem');

  it('writes each notification as an entry: when, what kind, and what it says', async () => {
    await renderFeed(items);

    const lists = screen.getAllByRole('list');
    const all = lists.flatMap((list) => entriesOf(list));
    expect(all).toHaveLength(3);

    expect(within(all[0]!).getByText('Offer received')).toBeInTheDocument();
    expect(within(all[0]!).getByText('You received an offer of $2,750.00.')).toBeInTheDocument();
    expect(within(all[1]!).getByText('Item received')).toBeInTheDocument();
  });

  it('puts the entries of one day under a heading of that day, and stamps each with the time alone', async () => {
    await renderFeed(items);

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(2);
    // The day's own words are the browser's, in the page's language; the date is a date.
    expect(headings[0]).toHaveTextContent(/October 27/);
    expect(headings[1]).toHaveTextContent(/October 25/);

    const [first] = screen.getAllByRole('list');
    expect(first).toHaveAccessibleName(headings[0]!.textContent!);
    expect(entriesOf(first!)).toHaveLength(2);
    const stamp = entriesOf(first!)[0]!.querySelector('.date')!;
    expect(stamp.textContent).toMatch(/^\d{1,2}:\d{2}/);
    expect(stamp.textContent).not.toMatch(/2026/);
  });

  it('shows the card an item entry is about, in its case, with its serial; and the kind of thing for the rest', async () => {
    await renderFeed(items);

    const [first] = screen.getAllByRole('list');
    const [offer, received] = entriesOf(first!);
    expect(received!.querySelector('.register-thumb .photo-thumb')).not.toBeNull();
    expect(within(received!).getAllByText('SN-DR97-0001').some((el) => el.closest('.serial'))).toBe(true);
    // Decoration: the words beside it say what it is.
    expect(received!.querySelector('.register-thumb')).toHaveAttribute('aria-hidden', 'true');

    expect(offer!.querySelector('.register-thumb')).toBeNull();
    expect(offer!.querySelector('.register-glyph svg')).not.toBeNull();
  });

  it('lets the date read the way its own words do, and isolates the sentence the server wrote', async () => {
    await renderFeed(items);

    const [first] = screen.getAllByRole('list');
    const when = entriesOf(first!)[0]!.querySelector('.date');
    // A date is not set apart as a code is: it reads the way its own words do.
    expect(when).not.toHaveAttribute('dir');
    expect(screen.getAllByRole('heading', { level: 3 })[0]!.querySelector('.date')).not.toHaveAttribute('dir');

    const sentence = within(entriesOf(first!)[0]!).getByText('You received an offer of $2,750.00.');
    expect(sentence.tagName).toBe('BDI');
    expect(sentence).toHaveAttribute('dir', 'auto');
  });

  it('shows the message alone, never the fields of the event under it', async () => {
    await renderFeed([
      note('n4', 'item_sold', { message: 'Your Rayquaza ex sold for $260.00.', price: 26_000, shipmentCode: 'SHP-AAAA1111' }, '2026-10-27T13:00:00.000Z'),
      note('n5', 'buyout_quoted', { amount: 12_000, requestCode: 'SR-BBBB2222' }, '2026-10-27T14:00:00.000Z'),
    ]);
    const all = screen.getAllByRole('list').flatMap((list) => entriesOf(list));
    expect(all[0]).toHaveTextContent('Your Rayquaza ex sold for $260.00.');
    expect(all[0]).not.toHaveTextContent(/Price:|Shipment Code:|26000/);
    expect(all[1]!.querySelector('.register-entry')).toBeNull();
    expect(all[1]).not.toHaveTextContent(/Amount:|Request Code:|12000|—/);
  });

  it('says so when there is nothing', async () => {
    await renderFeed([]);

    expect(screen.queryAllByRole('list')).toHaveLength(0);
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});

describe('a notification leads to what it is about', () => {
  it('opens the parcel, the shipment, the offers or the trades it names, by code and never by a raw id', async () => {
    await renderFeed([
      note('p', 'parcel_received', { parcelCode: 'PKG-AAAA1111', message: 'Parcel PKG-AAAA1111 arrived.' }, '2026-10-27T12:00:00.000Z'),
      note('s', 'shipment_out', { shipmentCode: 'SHP-BBBB2222', message: 'Shipment SHP-BBBB2222 left.' }, '2026-10-27T12:01:00.000Z'),
      note('o', 'offer_countered', { message: 'The seller countered.' }, '2026-10-27T12:02:00.000Z'),
      note('w', 'swap_completed', { transactionCode: 'TXN-CCCC3333', message: 'Your swap TXN-CCCC3333 was completed.' }, '2026-10-27T12:03:00.000Z'),
      note('x', 'shipment_out', { message: 'A shipment left.' }, '2026-10-27T12:04:00.000Z'),
    ]);
    const entry = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

    within(entry('Parcel PKG-AAAA1111 arrived.')).getByRole('button', { name: 'Open the parcel' }).click();
    expect(window.location.hash).toBe('#/inbound/parcels?parcel=PKG-AAAA1111');

    within(entry('Shipment SHP-BBBB2222 left.')).getByRole('button', { name: 'Open the shipment' }).click();
    expect(window.location.hash).toBe('#/shipping-services/tracking?shipment=SHP-BBBB2222');

    within(entry('The seller countered.')).getByRole('button', { name: 'Go to my offers' }).click();
    expect(window.location.hash).toBe('#/marketplace/offers');

    within(entry('Your swap TXN-CCCC3333 was completed.')).getByRole('button', { name: 'Go to my trades' }).click();
    expect(window.location.hash).toBe('#/marketplace/trade');

    expect(within(entry('A shipment left.')).queryByRole('button', { name: 'Open the shipment' })).toBeNull();
  });
});
