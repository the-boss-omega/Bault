import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const post = vi.fn();
const get = vi.fn();

class MockApiError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: MockApiError,
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const sectionPath = '../../apps/web/src/areas/admin/OutboxSection';
const section = () =>
  import(/* @vite-ignore */ sectionPath) as Promise<typeof import('../../apps/web/src/areas/admin/OutboxSection')>;
const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const PARKED = [
  {
    id: 'm1',
    eventType: 'item_donated',
    aggregateType: 'item',
    attempts: 5,
    lastError: 'connect ECONNREFUSED smtp.example.invalid:587',
    createdAt: '2026-10-14T09:00:00.000Z',
    lastAttemptAt: '2026-10-14T09:05:00.000Z',
    payloadKeys: ['userId'],
  },
  {
    id: 'm2',
    eventType: 'password_reset_requested',
    aggregateType: 'password_reset',
    attempts: 5,
    lastError: 'token=[redacted]',
    createdAt: '2026-10-14T10:00:00.000Z',
    lastAttemptAt: '2026-10-14T10:05:00.000Z',
    payloadKeys: ['email'],
  },
];

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  window.location.hash = '';
});

describe('the parked messages', () => {
  it('lists what failed, how often and why', async () => {
    get.mockResolvedValue(PARKED);
    const { OutboxSection } = await section();
    renderIn(<OutboxSection onMsg={() => {}} onError={() => {}} />);
    expect(await screen.findByText('item_donated')).toBeInTheDocument();
    expect(screen.getByText('password_reset_requested')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^requeue/i })).toHaveLength(2);
  });

  it('requeues the message whose button was pressed, and takes it off the list', async () => {
    const user = userEvent.setup();
    const onMsg = vi.fn();
    get.mockResolvedValueOnce(PARKED).mockResolvedValue([PARKED[1]]);
    post.mockResolvedValueOnce({ id: 'm1', status: 'requeued' });
    const { OutboxSection } = await section();
    renderIn(<OutboxSection onMsg={onMsg} onError={() => {}} />);

    const row = (await screen.findByText('item_donated')).closest('tr')!;
    await user.click(within(row as HTMLElement).getByRole('button', { name: /^requeue/i }));
    expect(post).toHaveBeenCalledWith('/admin/outbox/m1/requeue');
    await waitFor(() => expect(screen.queryByText('item_donated')).not.toBeInTheDocument());
    expect(onMsg).toHaveBeenCalledWith(expect.stringMatching(/requeued/i));
  });

  it('says so when somebody else got there first', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    get.mockResolvedValueOnce(PARKED).mockResolvedValue([PARKED[1]]);
    post.mockRejectedValueOnce(new MockApiError('client', 409, 'This message is not parked.', 'outbox_not_parked'));
    const { OutboxSection } = await section();
    renderIn(<OutboxSection onMsg={() => {}} onError={onError} />);

    const row = (await screen.findByText('item_donated')).closest('tr')!;
    await user.click(within(row as HTMLElement).getByRole('button', { name: /^requeue/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/already requeued or delivered/i)));
    await waitFor(() => expect(screen.queryByText('item_donated')).not.toBeInTheDocument());
  });

  it('says plainly when nothing is parked', async () => {
    get.mockResolvedValue([]);
    const { OutboxSection } = await section();
    renderIn(<OutboxSection onMsg={() => {}} onError={() => {}} />);
    expect(await screen.findByText(/nothing is parked/i)).toBeInTheDocument();
  });
});

describe('the admin console', () => {
  it('shows how many messages are parked on the tab, before it is opened', async () => {
    get.mockImplementation(async (path: string) => (path === '/admin/outbox/parked' ? PARKED : []));
    window.location.hash = '#/admin/users';
    renderIn(<AdminConsole currentUserId="me" />);
    expect(await screen.findByRole('tab', { name: /parked messages \(2\)/i })).toBeInTheDocument();
  });
});
