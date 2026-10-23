import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {
    constructor(
      readonly kind: string,
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));

const { ApiError } = await import('../../apps/web/src/shared/api');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ProfilePage } = await import('../../apps/web/src/areas/customer/profile/ProfilePage');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');

const COUNTRIES = [
  {
    code: 'US',
    name: 'United States',
    domestic: true,
    regionRequired: true,
    regions: [
      { code: 'NJ', name: 'New Jersey' },
      { code: 'NY', name: 'New York' },
    ],
  },
  { code: 'NL', name: 'Netherlands', domestic: false, regionRequired: false },
];

const OLD_US = {
  id: 'a1',
  label: 'Home',
  recipient: 'Red Ashwood',
  line1: '12 Vine St',
  city: 'Trenton',
  region: null,
  country: 'US',
  postalCode: '08608',
  isDefault: true,
};

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

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

function answer(addresses: unknown[]) {
  get.mockImplementation((path: string) => {
    if (path === '/shipping/countries') return Promise.resolve(COUNTRIES);
    if (path === '/shipping/services') return Promise.resolve(CATALOGUE);
    if (path === '/me/addresses') return Promise.resolve(addresses);
    if (path === '/me/profile') return Promise.resolve(PROFILE);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '';
});

describe('an address form asks for the state or province where carriers need one', () => {
  async function addForm() {
    window.location.hash = '#/profile/addresses';
    renderIn(<ProfilePage />);
    const form = (await screen.findByRole('heading', { name: 'Add address' })).closest('section') as HTMLElement;
    const field = (name: RegExp) => form.querySelector(`#${CSS.escape(screen.getAllByLabelText(name).at(-1)!.id)}`) as HTMLInputElement;
    fireEvent.change(field(/^Label/), { target: { value: 'Office' } });
    fireEvent.change(field(/^Recipient name/), { target: { value: 'Red Ashwood' } });
    fireEvent.change(field(/^Street and number/), { target: { value: '55 Wall St' } });
    fireEvent.change(field(/^City/), { target: { value: 'New York' } });
    fireEvent.change(field(/^Postal code/), { target: { value: '10005' } });
    return { form, field };
  }

  it('makes a US address choose its state before it can be added', async () => {
    answer([]);
    post.mockResolvedValue({ id: 'a2' });
    const { form, field } = await addForm();
    fireEvent.change(field(/^Country/), { target: { value: 'US' } });

    const add = screen.getByRole('button', { name: 'Add address' });
    const state = field(/^State \/ province/);
    expect(state.tagName).toBe('SELECT');
    expect(form.textContent).toContain('Required for United States');
    expect(add).toBeDisabled();

    fireEvent.change(state, { target: { value: 'NY' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/me/addresses', expect.objectContaining({ country: 'US', region: 'NY' })),
    );
  });

  it('leaves it optional, as free text, where the carriers do not need it', async () => {
    answer([]);
    post.mockResolvedValue({ id: 'a3' });
    const { field } = await addForm();
    fireEvent.change(field(/^Country/), { target: { value: 'NL' } });

    expect(field(/^State \/ province/).tagName).toBe('INPUT');
    const add = screen.getByRole('button', { name: 'Add address' });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/me/addresses', expect.objectContaining({ country: 'NL', region: null })),
    );
  });

  it('marks a saved US address that has no state, so it can be fixed before shipping', async () => {
    answer([OLD_US]);
    window.location.hash = '#/profile/addresses';
    renderIn(<ProfilePage />);
    expect(await screen.findByText('State or province missing')).toBeInTheDocument();
  });

  it('asks for it in Hebrew on a Hebrew page', async () => {
    localStorage.setItem('bault.locale', 'he');
    answer([OLD_US]);
    window.location.hash = '#/profile/addresses';
    renderIn(<ProfilePage />);
    expect(await screen.findByText('חסר מחוז או מדינה')).toBeInTheDocument();
  });
});

describe('the shipment composer stops at an address with no state', () => {
  const ITEMS = [{ id: 'i1', typeClass: 'trading_card', description: 'Rayquaza ex #97/97' }];

  it('says what is missing and offers to edit the address, without asking for a quote', async () => {
    answer([OLD_US]);
    renderIn(<ShipmentComposer items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Rayquaza/ }));

    expect(await screen.findByText(/has no state or province/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 450));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit the address' }));
    expect(window.location.hash).toBe('#/profile/addresses');
  });

  it('shows the same notice when the server refuses the address for it', async () => {
    answer([{ ...OLD_US, region: 'NJ' }]);
    post.mockRejectedValue(
      new ApiError('client', 422, 'Add the state or province to the address "Home".', 'address_region_required'),
    );
    const errors: (string | null)[] = [];
    renderIn(
      <ShipmentComposer items={ITEMS} onError={(m) => errors.push(m)} onStatus={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: /Rayquaza/ }));

    expect(await screen.findByText(/has no state or province/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit the address' })).toBeInTheDocument();
  });
});
