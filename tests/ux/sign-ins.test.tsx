import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

/**
 * The administrator's sign-in log.
 *
 * Before `login_attempt` a failed sign-in left no trace anywhere, so the
 * question this screen answers — is somebody guessing passwords? — could not be
 * asked. These pin that failures are shown, that a stranger's guess at an
 * address with no account is shown as what was typed, and that the pattern is
 * pulled out above the table rather than left for somebody to spot.
 */
const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
  // `errorText` asks the module which failure this was.
  apiErrorKey: () => null,
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
    // Address shown without the IPv6-mapping prefix, device in words.
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
});
