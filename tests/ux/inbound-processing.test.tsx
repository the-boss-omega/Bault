import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { InboundPage } = await import('../../apps/web/src/areas/customer/inbound/InboundPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function renderProcessing(workflow: unknown, pending = false) {
  get.mockImplementation((path: string) => {
    if (path === '/parcels/workflow/status') return pending ? new Promise(() => {}) : Promise.resolve(workflow);
    return Promise.resolve([]);
  });
  window.location.hash = '#/inbound/processing';
  return render(
    <I18nProvider>
      <InboundPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe('inbound, the processing floor', () => {
  it('shows the two places a parcel waits, each with how many are in it and what it means', async () => {
    renderProcessing({
      awaitingOpen: 4,
      awaitingProcessing: 0,
      unclaimed: 0,
      oldestReceivedAt: '2026-10-25T09:00:00.000Z',
      oldestWaitingHours: 52,
    });

    const places = await screen.findByRole('list', { name: 'Processing' });
    const [open, processing] = within(places).getAllByRole('listitem');

    expect(within(open!).getByText('Waiting to be opened')).toBeInTheDocument();
    await waitFor(() => expect(open!.querySelector('.queue-figure')).toHaveTextContent('4'));
    expect(within(open!).getByText('At the warehouse, still sealed')).toBeInTheDocument();

    expect(within(processing!).getByText('Waiting to be catalogued')).toBeInTheDocument();
    expect(processing!.querySelector('.queue-figure')).toHaveTextContent('0');
  });

  it('lights the place that has parcels in it and leaves the empty one dark', async () => {
    renderProcessing({ awaitingOpen: 4, awaitingProcessing: 0, unclaimed: 0, oldestReceivedAt: null, oldestWaitingHours: null });

    const places = await screen.findByRole('list', { name: 'Processing' });
    const [open, processing] = within(places).getAllByRole('listitem');
    expect(open).toHaveAttribute('data-waiting', 'true');
    expect(processing).toHaveAttribute('data-waiting', 'false');
  });

  it('says how long the oldest has waited, and since when', async () => {
    renderProcessing({
      awaitingOpen: 1,
      awaitingProcessing: 1,
      unclaimed: 0,
      oldestReceivedAt: '2026-10-25T09:00:00.000Z',
      oldestWaitingHours: 52,
    });

    expect(await screen.findByText('52 hours')).toBeInTheDocument();
    expect(screen.getByText(/^Since /)).toBeInTheDocument();
  });

  it('says nothing is waiting, with a dash for the wait, when nothing is', async () => {
    renderProcessing({ awaitingOpen: 0, awaitingProcessing: 0, unclaimed: 0, oldestReceivedAt: null, oldestWaitingHours: null });

    expect(await screen.findByText('Nothing is waiting at the moment')).toBeInTheDocument();
    expect(document.querySelector('.queue-hours')).toHaveTextContent('—');
  });

  it('shows a dash, not a zero, for what has not arrived yet', async () => {
    renderProcessing(null, true);

    const places = await screen.findByRole('list', { name: 'Processing' });
    const figures = Array.from(places.querySelectorAll('.queue-figure')).map((f) => f.textContent);
    expect(figures).toEqual(['—', '—']);
  });
});
