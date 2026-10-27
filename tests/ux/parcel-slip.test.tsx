import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { RegisterParcelForm } = await import('../../apps/web/src/areas/customer/inbound/InboundPage');

const FACILITIES = [
  { code: 'NJ', name: 'Bault New Jersey', role: 'primary', lines: [], taxRateBps: 663 },
  { code: 'DE', name: 'Bault Delaware', role: 'forwarding', lines: [], taxRateBps: 0 },
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) => (path === '/me/inbound-addresses' ? FACILITIES : []));
  post.mockResolvedValue({ code: 'PKG-TEST0001' });
});

function form() {
  return render(
    <I18nProvider>
      <RegisterParcelForm onRegistered={async () => {}} onError={() => {}} />
    </I18nProvider>,
  );
}

describe('registering a parcel, written on its label as it is typed', () => {
  it('says what is not yet said, and has no barcode until there is a number to make one of', async () => {
    form();
    const label = await screen.findByRole('region', { name: 'Tell us a parcel is coming' });
    expect(label).toHaveTextContent('Contents not declared');
    expect(label.querySelector('.barcode')).toBeNull();
    await waitFor(() => expect(within(label).getByText('Sent to').nextElementSibling).toHaveTextContent('Bault New Jersey'));
    expect(within(label).queryByText('Carrier')).not.toBeInTheDocument();
    expect(within(label).getByText('On its way')).toBeInTheDocument();
  });

  it('writes the contents, the carrier and the facility as they are chosen, and the number as a barcode', async () => {
    form();
    const user = userEvent.setup();
    const label = await screen.findByRole('region', { name: 'Tell us a parcel is coming' });

    await user.type(screen.getByRole('textbox', { name: 'What should be inside' }), 'Two raw Rayquaza singles');
    expect(label.querySelector('.drawer-tag-title')).toHaveTextContent('Two raw Rayquaza singles');

    await user.type(screen.getByRole('textbox', { name: 'Carrier' }), 'USPS');
    expect(within(label).getByText('Carrier').nextElementSibling).toHaveTextContent('USPS');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sent to' }), 'DE');
    expect(within(label).getByText('Sent to').nextElementSibling).toHaveTextContent('Bault Delaware');

    await user.type(screen.getByRole('textbox', { name: /Tracking number/ }), '9400100000000000000042');
    expect(label.querySelector('.barcode svg')).not.toBeNull();
    expect(label.querySelector('.barcode svg')).toHaveAttribute('aria-label', 'Barcode 9400100000000000000042');

    await user.click(screen.getByRole('checkbox', { name: 'Shipped from outside the US' }));
    expect(within(label).getByText('Shipped from outside the US').nextElementSibling).toHaveTextContent('✓');
  });

  it('registers what the label says', async () => {
    form();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Tell us a parcel is coming' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Sent to' })).toHaveValue('NJ'));
    await user.type(screen.getByRole('textbox', { name: 'What should be inside' }), 'Two raw Rayquaza singles');
    await user.type(screen.getByRole('textbox', { name: /Tracking number/ }), '9400100000000000000042');
    await user.click(screen.getByRole('button', { name: 'Register parcel' }));
    expect(post).toHaveBeenCalledWith('/me/parcels', {
      facilityCode: 'NJ',
      carrier: undefined,
      trackingNumber: '9400100000000000000042',
      declaredContents: 'Two raw Rayquaza singles',
      internationalOrigin: false,
    });
  });
});
