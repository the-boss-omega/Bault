import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

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
  channel: 'in_app',
  status: 'sent',
  createdAt,
});

function feedOf(items: unknown[], loading = false) {
  return { items, error: null, loading, reload: vi.fn(), unseen: 0, markSeen: vi.fn() } as never;
}

function renderFeed(items: unknown[], loading = false) {
  get.mockResolvedValue({ categories: [], channels: [], events: [] });
  window.location.hash = '#/notifications';
  return render(
    <I18nProvider>
      <NotificationsPage feed={feedOf(items, loading)} onSeen={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe('the notifications, a register', () => {
  const items = [
    note('n1', 'offer_received', { message: 'You received an offer of $2,750.00.' }, '2026-10-27T06:08:00.000Z'),
    note('n2', 'item_received', { message: 'Item SN-DR97-0001 was received into your vault.' }, '2026-10-26T09:30:00.000Z'),
  ];

  it('writes each notification as an entry: when, what kind, and what it says', () => {
    renderFeed(items);

    const list = screen.getByRole('list', { name: 'My notifications (2)' });
    const entries = within(list).getAllByRole('listitem');
    expect(entries).toHaveLength(2);

    expect(within(entries[0]!).getByText('Offer received')).toBeInTheDocument();
    expect(within(entries[0]!).getByText('You received an offer of $2,750.00.')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('Item received')).toBeInTheDocument();
  });

  it('keeps the date left to right, whichever way the page reads', () => {
    renderFeed(items);

    const [first] = within(screen.getByRole('list', { name: 'My notifications (2)' })).getAllByRole('listitem');
    const when = first!.querySelector('.date');
    expect(when).toHaveAttribute('dir', 'ltr');
    expect(when?.textContent).toMatch(/2026/);
  });

  it('says so when there is nothing', () => {
    renderFeed([]);

    expect(screen.queryByRole('list', { name: /My notifications/ })).not.toBeInTheDocument();
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });
});
