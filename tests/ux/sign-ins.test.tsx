import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { SignInsSection } = await import('../../apps/web/src/areas/admin/SignInsSection');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const LOG = {
  since: '2026-09-18T00:00:00.000Z',
  last24h: { successes: 1, failures: 6, failingAddresses: 2 },
  suspicious: [{ identifier: 'eldar@bault.dev', failures: 6, addresses: 2, lastAt: '2026-09-18T12:00:00.000Z' }],
  attempts: [
    { id: 'a1', occurredAt: '2026-09-18T12:00:00.000Z', outcome: 'bad_credentials', identifier: 'eldar@bault.dev', userId: 'u-e', ip: '::ffff:203.0.113.7', userAgent: 'curl/8.10.1', username: 'eldar', email: 'eldar@bault.dev', role: 'admin' },
    { id: 'a2', occurredAt: '2026-09-18T11:00:00.000Z', outcome: 'bad_credentials', identifier: 'ceo@bault.dev', userId: null, ip: '203.0.113.9', userAgent: null, username: null, email: null, role: null },
    { id: 'a3', occurredAt: '2026-09-18T10:00:00.000Z', outcome: 'success', identifier: 'red@bault.dev', userId: 'u-r', ip: '::ffff:127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36', username: 'red', email: 'red@bault.dev', role: 'user' },
  ],
};

beforeEach(() => get.mockReset());

describe('the sign-in log', () => {
  it('shows failures, not only successes', async () => {
    get.mockResolvedValue(LOG);
    render(<I18nProvider><SignInsSection onError={() => {}} /></I18nProvider>);

    expect(await screen.findAllByText('Wrong details')).toHaveLength(2);
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
    expect(screen.getByText('Chrome · Windows')).toBeInTheDocument();
    expect(screen.getByText('curl/8.10.1')).toBeInTheDocument();
  });

  it('shows a guess at an account that does not exist as what was typed', async () => {
    get.mockResolvedValue(LOG);
    render(<I18nProvider><SignInsSection onError={() => {}} /></I18nProvider>);
    expect(await screen.findByText('ceo@bault.dev')).toBeInTheDocument();
    expect(screen.getByText(/no such account/)).toBeInTheDocument();
  });

  it('pulls the guessing pattern out above the log', async () => {
    get.mockResolvedValue(LOG);
    render(<I18nProvider><SignInsSection onError={() => {}} /></I18nProvider>);
    const heading = await screen.findByText('A pattern of password guessing');
    const panel = heading.closest('section') ?? heading.parentElement!.parentElement!;
    expect(within(panel as HTMLElement).getByText('eldar@bault.dev')).toBeInTheDocument();
  });

  it('puts the three counts on one sheet, each with its name and what it counts', async () => {
    get.mockResolvedValue(LOG);
    render(<I18nProvider><SignInsSection onError={() => {}} /></I18nProvider>);
    const sheet = (await screen.findByText('Successful sign-ins')).closest('section') as HTMLElement;
    expect(sheet).toHaveClass('ledger-sheet');
    expect(within(sheet).getByText('Successful sign-ins').nextElementSibling).toHaveTextContent('1');
    expect(within(sheet).getByText('Failed attempts').nextElementSibling).toHaveTextContent('6');
    expect(within(sheet).getByText('Accounts at risk').nextElementSibling).toHaveTextContent('1');
  });

  it('reads the log in days: a heading for each, and under it a list named by it, an attempt to a line', async () => {
    get.mockResolvedValue({
      ...LOG,
      attempts: [
        ...LOG.attempts,
        { id: 'a4', occurredAt: '2026-09-17T09:00:00.000Z', outcome: 'success', identifier: 'red@bault.dev', userId: 'u-r', ip: '198.51.100.4', userAgent: null, username: 'red', email: 'red@bault.dev', role: 'user' },
      ],
    });
    render(<I18nProvider><SignInsSection onError={() => {}} /></I18nProvider>);
    const lists = await screen.findAllByRole('list');
    const days = lists.filter((list) => list.classList.contains('timeline--log'));
    expect(days).toHaveLength(2);
    expect(within(days[0]!).getAllByRole('listitem')).toHaveLength(3);
    expect(within(days[1]!).getAllByRole('listitem')).toHaveLength(1);
    // Each list is named by its own day's heading.
    for (const list of days) {
      const heading = document.getElementById(list.getAttribute('aria-labelledby')!);
      expect(heading?.tagName).toBe('H3');
    }
  });
});
