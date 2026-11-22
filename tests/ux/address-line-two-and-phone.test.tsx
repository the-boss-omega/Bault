import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    del: vi.fn(),
  },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ProfilePage } = await import('../../apps/web/src/areas/customer/profile/ProfilePage');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');

const COUNTRIES = [
  {
    code: 'US',
    name: 'United States',
    domestic: true,
    regionRequired: true,
    regions: [{ code: 'CA', name: 'California' }],
  },
  { code: 'NL', name: 'Netherlands', domestic: false, regionRequired: false },
];

const PROFILE = {
  id: 'u1',
  email: 'red@bault.dev',
  username: 'red',
  role: 'user',
  status: 'active',
  firstName: 'Red',
  lastName: 'Ashwood',
  fullName: 'Red Ashwood',
  nameReviewRequired: false,
};

const CATALOGUE = {
  services: [],
  addOns: [],
  boxes: [],
  maxInsuredValueMinor: 100_000,
  signatureRequiredAboveMinor: 50_000,
  paymentWindowDays: 7,
};

const FLAT = {
  id: 'a1',
  label: 'Flat',
  recipient: 'Red Ashwood',
  line1: '1200 Market St',
  line2: 'Apt 4B',
  city: 'San Francisco',
  region: 'CA',
  country: 'US',
  postalCode: '94102',
  phone: '+1 415-555-0134',
  isDefault: true,
};

function answer(addresses: unknown[]) {
  get.mockImplementation(async (path: string) => {
    if (path === '/shipping/countries') return COUNTRIES;
    if (path === '/shipping/services') return CATALOGUE;
    if (path === '/me/addresses') return addresses;
    if (path === '/me/profile') return PROFILE;
    if (path === '/auth/mfa') return { enabled: false, pending: false, required: false, recoveryCodesRemaining: 0 };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localStorage.clear();
  window.location.hash = '';
});

async function addresses() {
  window.location.hash = '#/profile/addresses';
  render(
    <I18nProvider>
      <ProfilePage />
    </I18nProvider>,
  );
  await act(async () => {});
}

const lines = (label: Element) => Array.from(label.querySelectorAll('address > span')).map((s) => s.textContent);

describe('an address has an apartment line and a phone for the carrier', () => {
  it('asks for the apartment under the street and the phone after the postal code, both optional', async () => {
    answer([]);
    await addresses();
    await screen.findByRole('heading', { name: 'Add address' });
    const inputs = Array.from(document.querySelectorAll('.request-form-fields input, .request-form-fields select'));
    const at = (name: RegExp) => inputs.indexOf(screen.getByLabelText(name));

    const apartment = screen.getByLabelText('Apartment, suite, unit (optional)');
    const phone = screen.getByLabelText(/^Phone for the carrier \(optional\)/);
    expect(at(/^Apartment, suite, unit/)).toBe(at(/^Street and number/) + 1);
    expect(at(/^Phone for the carrier/)).toBe(at(/^Postal code/) + 1);
    expect(apartment).toHaveAttribute('autocomplete', 'address-line2');
    expect(apartment).toHaveAttribute('maxlength', '100');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).toHaveAttribute('maxlength', '20');

    const label = document.querySelector('.request-slip .drawer-tag') as HTMLElement;
    expect(Array.from(label.querySelectorAll('address .drawer-tag-quiet')).map((q) => q.textContent)).toEqual([
      'Street and number',
      'City',
      'Country',
    ]);
  });

  it('says carriers want a phone for a parcel abroad, and not for one at home', async () => {
    answer([]);
    await addresses();
    await screen.findByRole('heading', { name: 'Add address' });
    const hint = 'Most carriers need a phone number for international parcels.';
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: 'NL' } });
    expect(screen.getByText(hint)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: 'US' } });
    expect(screen.queryByText(hint)).toBeNull();
  });

  it('writes both on the label as they are typed, and adds them with the address', async () => {
    answer([]);
    post.mockResolvedValue({ id: 'a9' });
    await addresses();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Add address' });
    await user.selectOptions(screen.getByLabelText(/^Country/), 'NL');
    await user.type(screen.getByLabelText(/^Label/), 'Canal');
    await user.type(screen.getByLabelText(/^Recipient name/), 'Red Ashwood');
    await user.type(screen.getByLabelText(/^Street and number/), 'Keizersgracht 12');
    await user.type(screen.getByLabelText(/^Apartment, suite, unit/), '3 hoog');
    await user.type(screen.getByLabelText(/^City/), 'Amsterdam');
    await user.type(screen.getByLabelText(/^Postal code/), '1015 CS');
    await user.type(screen.getByLabelText(/^Phone for the carrier/), '+31 20 555 0100');

    const label = document.querySelector('.request-slip .drawer-tag') as HTMLElement;
    expect(lines(label)).toEqual(['Keizersgracht 12', '3 hoog', 'Amsterdam 1015 CS', 'Netherlands', '+31 20 555 0100']);

    await user.click(screen.getByRole('button', { name: 'Add address' }));
    expect(post).toHaveBeenCalledWith(
      '/me/addresses',
      expect.objectContaining({ line1: 'Keizersgracht 12', line2: '3 hoog', phone: '+31 20 555 0100' }),
    );
  });

  it('shows both on a saved address, and saves them when it is edited', async () => {
    answer([FLAT]);
    patch.mockResolvedValue({});
    await addresses();
    const user = userEvent.setup();
    const saved = await screen.findByRole('article', { name: 'Flat' });
    expect(lines(saved)).toEqual(['1200 Market St', 'Apt 4B', 'San Francisco, CA 94102', 'United States', '+1 415-555-0134']);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const item = document.querySelector('.tag-item.is-editing') as HTMLElement;
    const apartment = within(item).getByLabelText(/^Apartment, suite, unit/);
    await user.clear(apartment);
    await user.type(apartment, 'Suite 9');
    await user.clear(within(item).getByLabelText(/^Phone for the carrier/));
    await user.click(within(item).getByRole('button', { name: 'Save address' }));
    expect(patch).toHaveBeenCalledWith('/me/addresses/a1', expect.objectContaining({ line2: 'Suite 9', phone: null }));
  });

  it('writes an address without them as before', async () => {
    answer([{ ...FLAT, line2: null, phone: null }]);
    await addresses();
    const saved = await screen.findByRole('article', { name: 'Flat' });
    expect(lines(saved)).toEqual(['1200 Market St', 'San Francisco, CA 94102', 'United States']);
  });
});

describe('the shipment composer shows the apartment and the phone on the collector’s own address', () => {
  it('writes both on the address card the parcel goes to', async () => {
    answer([FLAT]);
    render(
      <I18nProvider>
        <ShipmentComposer
          items={[{ id: 'i1', typeClass: 'trading_card', description: 'Rayquaza ex #97/97' }]}
          onCreated={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: /Rayquaza/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const card = (await screen.findByRole('radio', { name: /Flat/ })).closest('label') as HTMLElement;
    await waitFor(() => expect(card).toHaveTextContent('Apt 4B'));
    expect(card).toHaveTextContent('+1 415-555-0134');
  });
});
