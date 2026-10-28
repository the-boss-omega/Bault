import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

const { ShippingServicesPage } = await import('../../apps/web/src/areas/customer/shipping/ShippingServicesPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const item = (id: string, serial: string, lifecycleState = 'stored') => ({
  id,
  serialNumber: serial,
  typeClass: 'trading_card',
  description: 'A card',
  conditionGrade: null,
  lifecycleState,
  barcode: `BC-${id}`,
});

const request = (id: string, status: string) => ({
  id,
  type: 'grading',
  status,
  itemId: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  typeFields: null,
});

function renderOverview(items: unknown[], requests: unknown[], pending = false) {
  get.mockImplementation((path: string) => {
    if (pending) return new Promise(() => {});
    if (path === '/vault/items') return Promise.resolve(items);
    if (path === '/services/mine') return Promise.resolve(requests);
    return Promise.resolve([]);
  });
  window.location.hash = '#/shipping-services';
  return render(
    <I18nProvider>
      <ShippingServicesPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
});

describe('shipping and services, the overview', () => {
  it('leads each line with its figure, named: what is ready to ship, what is open, what is closed', async () => {
    renderOverview(
      [item('i1', 'SN-0001'), item('i2', 'SN-0002'), item('i3', 'SN-0003', 'listed')],
      [request('r1', 'requested'), request('r2', 'in_progress'), request('r3', 'completed'), request('r4', 'cancelled')],
    );

    // Only what is stored can go in a shipment.
    await waitFor(() => expect(screen.getByText('Ready to ship').previousElementSibling).toHaveTextContent('2'));
    await waitFor(() => expect(screen.getByText('Open requests').previousElementSibling).toHaveTextContent('2'));
    expect(screen.getByText('2 Closed requests')).toBeInTheDocument();
  });

  it('says what each line is and gives the way in', async () => {
    renderOverview([], []);

    const lines = await screen.findAllByRole('listitem');
    const titles = lines.map((line) => within(line).getByRole('heading', { level: 3 }).textContent);
    expect(titles).toEqual(['Shipping', 'Tracking', 'Service requests']);

    expect(screen.getByRole('button', { name: 'Create a shipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Track a shipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My requests' })).toBeInTheDocument();
  });

  it('puts each title before its figure in the document, so jumping by heading lands on it and meets the figure next', async () => {
    renderOverview([item('i1', 'SN-0001')], []);

    const lines = await screen.findAllByRole('listitem');
    for (const line of lines) {
      const heading = within(line).getByRole('heading', { level: 3 });
      const figure = line.querySelector('.departure-figure')!;
      expect(heading.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('shows a dash, not a zero, for what has not arrived yet', async () => {
    const { container } = renderOverview([], [], true);

    await screen.findAllByRole('listitem');
    const numbers = Array.from(container.querySelectorAll('.departure-number')).map((n) => n.textContent);
    expect(numbers).toEqual(['—', '—']);
    expect(screen.queryByText(/Closed requests/)).not.toBeInTheDocument();
  });

  it('takes you to the tab a line is about', async () => {
    const user = userEvent.setup();
    renderOverview([], []);

    await user.click(await screen.findByRole('button', { name: 'Track a shipment' }));
    expect(window.location.hash).toBe('#/shipping-services/tracking');
  });

  it('draws the tracking line with an icon, not a figure, because a lookup has no count', async () => {
    const { container } = renderOverview([], []);

    await screen.findAllByRole('listitem');
    const tracking = container.querySelectorAll('.departure')[1]!;
    expect(tracking.querySelector('.departure-number')).toBeNull();
    expect(tracking.querySelector('.departure-icon')).toHaveAttribute('aria-hidden', 'true');
  });
});
