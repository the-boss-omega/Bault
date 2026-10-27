import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const RUNS = [
  {
    id: 's1',
    thresholdDays: 90,
    runAt: '2026-10-27T12:00:00.000Z',
    chargedItemIds: ['a', 'b', 'c'],
    totalAmount: 1400,
    currency: 'USD',
  },
  {
    id: 's2',
    thresholdDays: 180,
    runAt: '2026-10-26T12:00:00.000Z',
    chargedItemIds: [],
    totalAmount: 0,
    currency: 'USD',
  },
];

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

async function storage(runs: unknown[]) {
  get.mockImplementation(async (path: string) => (path === '/admin/storage-fee-runs' ? runs : []));
  window.location.hash = '#/admin/storage';
  render(
    <I18nProvider>
      <AdminConsole currentUserId="me" />
    </I18nProvider>,
  );
  await screen.findByRole('heading', { name: /^Previous runs \(/ });
}

describe('the storage sweep, a statement', () => {
  it('has a line to each run: its date, what it charged in all, the threshold it was run at and how many items it charged', async () => {
    await storage(RUNS);
    const lines = within(document.querySelector('.fee-sheet') as HTMLElement).getAllByRole(
      'listitem',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(/Oct 2[67], 2026/);
    expect(lines[0]!.querySelector('.fee-run-total')).toHaveTextContent('$14.00');
    expect(lines[0]).toHaveTextContent('Day threshold 90 · Items charged 3');
    expect(lines[1]!.querySelector('.fee-run-total')).toHaveTextContent('$0.00');
    expect(lines[1]).toHaveTextContent('Day threshold 180 · Items charged 0');
  });

  it('reads each figure as a figure, left to right', async () => {
    await storage(RUNS);
    for (const total of document.querySelectorAll('.fee-run-total'))
      expect(total).toHaveAttribute('dir', 'ltr');
  });

  it('says there have been no runs, and still says billing is automatic, when there have not', async () => {
    await storage([]);
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    expect(screen.getByText(/Billing is fully automatic/)).toBeInTheDocument();
    expect(document.querySelector('.fee-sheet')).toBeNull();
  });
});
