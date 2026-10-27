import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

const COUNTRIES = [
  {
    code: 'US',
    name: 'United States',
    domestic: true,
    regionRequired: true,
    regions: [
      { code: 'CA', name: 'California' },
      { code: 'NY', name: 'New York' },
    ],
  },
  { code: 'IL', name: 'Israel', domestic: false, regionRequired: false },
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

const HOME = {
  id: 'a1',
  label: 'Home',
  recipient: 'Red Ashwood',
  line1: '1200 Market St',
  city: 'San Francisco',
  region: 'CA',
  country: 'US',
  postalCode: '94102',
  isDefault: true,
};

const OLD = {
  ...HOME,
  id: 'a2',
  label: 'Old flat',
  line1: '12 Vine St',
  city: 'Trenton',
  region: null,
  postalCode: '08608',
  isDefault: false,
};

function answer(addresses: unknown[] = [HOME]) {
  get.mockImplementation(async (path: string) => {
    if (path === '/shipping/countries') return COUNTRIES;
    if (path === '/me/addresses') return addresses;
    if (path === '/me/profile') return PROFILE;
    if (path === '/auth/mfa')
      return { enabled: false, pending: false, required: false, recoveryCodesRemaining: 0 };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
});

async function profile(tab: string) {
  window.location.hash = `#/profile/${tab}`;
  const view = render(
    <I18nProvider>
      <ProfilePage />
    </I18nProvider>,
  );
  await act(async () => {});
  return view;
}

describe('the account, a card that is written as the name is', () => {
  it('has who it is, how to reach them, what cannot be changed, and what they are', async () => {
    answer();
    await profile('details');
    const card = await screen.findByRole('region', { name: 'My details' });
    expect(within(card).getByText('Red Ashwood')).toBeInTheDocument();
    expect(within(card).getByText('Email').nextElementSibling).toHaveTextContent('red@bault.dev');
    expect(within(card).getByText('Username').nextElementSibling).toHaveTextContent('@red');
    expect(within(card).getByText('permanent — cannot be changed')).toBeInTheDocument();
    expect(within(card).getByText('Collector')).toBeInTheDocument();
    // The labels were written for a list, with a colon; on a card the leader between name and value says it.
    expect(card.querySelector('dt')?.textContent).not.toMatch(/:$/);
  });

  it('follows the name as it is typed, and says there is none when there is none', async () => {
    answer();
    await profile('details');
    const user = userEvent.setup();
    const card = await screen.findByRole('region', { name: 'My details' });
    const title = () => card.querySelector('.drawer-tag-title') as HTMLElement;

    const last = screen.getByRole('textbox', { name: 'Last name' });
    await user.clear(last);
    await user.type(last, 'Ashwood-Cohen');
    expect(title()).toHaveTextContent('Red Ashwood-Cohen');

    await user.clear(screen.getByRole('textbox', { name: 'First name' }));
    await user.clear(last);
    expect(title().querySelector('.drawer-tag-quiet')).toHaveTextContent('No name set');
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  });

  it('saves the name that is on the card', async () => {
    answer();
    patch.mockResolvedValue({ ...PROFILE, firstName: 'Redmond', fullName: 'Redmond Ashwood' });
    await profile('details');
    const user = userEvent.setup();
    const first = await screen.findByRole('textbox', { name: 'First name' });
    await user.clear(first);
    await user.type(first, '  Redmond ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(patch).toHaveBeenCalledWith('/me/profile', {
      firstName: 'Redmond',
      lastName: 'Ashwood',
    });
  });
});

describe('the addresses, a label for each place', () => {
  const lines = (label: HTMLElement) =>
    Array.from(label.querySelectorAll('address > span')).map((s) => s.textContent);

  it('writes a saved address as it is written on a parcel, and keeps its actions off the paper', async () => {
    answer();
    await profile('addresses');
    const label = await screen.findByRole('region', { name: 'Home' });
    expect(label.querySelector('.drawer-tag-title')).toHaveTextContent('Red Ashwood');
    expect(lines(label)).toEqual(['1200 Market St', 'San Francisco, CA 94102', 'United States']);
    expect(within(label).getByText('Default')).toBeInTheDocument();
    // The buttons are the page's, under the label, not on it.
    expect(within(label).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('marks a label that is missing what carriers need, so it can be fixed before it is used', async () => {
    answer([HOME, OLD]);
    await profile('addresses');
    const label = await screen.findByRole('region', { name: 'Old flat' });
    expect(within(label).getByText('State or province missing')).toBeInTheDocument();
    expect(within(label).queryByText('Default')).toBeNull();
  });

  it('writes the address being added as a label, asking for what is not yet written', async () => {
    answer([]);
    await profile('addresses');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Add address' });
    const label = () => document.querySelector('.request-slip .drawer-tag') as HTMLElement;

    // Nothing written: the label names what it will want, in the quiet ink.
    expect(label().querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent(
      'Recipient name',
    );
    expect(
      Array.from(label().querySelectorAll('address .drawer-tag-quiet')).map((q) => q.textContent),
    ).toEqual(['Street and number', 'City', 'Country']);

    await user.type(screen.getByLabelText(/^Label/), 'Office');
    await user.type(screen.getByLabelText(/^Recipient name/), 'Red Ashwood');
    await user.type(screen.getByLabelText(/^Street and number/), '77 Rothschild Blvd');
    await user.type(screen.getByLabelText(/^City/), 'Tel Aviv');
    await user.type(screen.getByLabelText(/^Postal code/), '6688120');
    await user.selectOptions(screen.getByLabelText(/^Country/), 'IL');

    expect(label()).toHaveAccessibleName('Office');
    expect(label().querySelector('.drawer-tag-title')).toHaveTextContent('Red Ashwood');
    expect(lines(label())).toEqual(['77 Rothschild Blvd', 'Tel Aviv 6688120', 'Israel']);
    expect(label().querySelector('.drawer-tag-quiet')).toBeNull();
    expect(within(label()).queryByText('Default')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Default' }));
    expect(within(label()).getByText('Default')).toBeInTheDocument();
  });

  it('warns on the label, as the state is left out, where the country needs one', async () => {
    answer([]);
    await profile('addresses');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Add address' });
    await user.selectOptions(screen.getByLabelText(/^Country/), 'US');
    const label = document.querySelector('.request-slip .drawer-tag') as HTMLElement;
    expect(within(label).getByText('State or province missing')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^State \/ province/), 'NY');
    expect(within(label).queryByText('State or province missing')).toBeNull();
    expect(label.querySelector('address')).toHaveTextContent('NY');
  });

  it('adds what the label shows', async () => {
    answer([]);
    post.mockResolvedValue({ id: 'a9' });
    await profile('addresses');
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Add address' });
    await user.type(screen.getByLabelText(/^Label/), 'Office');
    await user.type(screen.getByLabelText(/^Recipient name/), 'Red Ashwood');
    await user.type(screen.getByLabelText(/^Street and number/), '77 Rothschild Blvd');
    await user.type(screen.getByLabelText(/^City/), 'Tel Aviv');
    await user.type(screen.getByLabelText(/^Postal code/), '6688120');
    await user.selectOptions(screen.getByLabelText(/^Country/), 'IL');
    await user.click(screen.getByRole('button', { name: 'Add address' }));
    expect(post).toHaveBeenCalledWith('/me/addresses', {
      label: 'Office',
      recipient: 'Red Ashwood',
      line1: '77 Rothschild Blvd',
      city: 'Tel Aviv',
      region: null,
      country: 'IL',
      postalCode: '6688120',
      isDefault: false,
    });
  });

  it('is edited beside the label it makes, and saves what that label shows', async () => {
    answer();
    patch.mockResolvedValue({});
    await profile('addresses');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const item = document.querySelector('.tag-item.is-editing') as HTMLElement;
    expect(item).not.toBeNull();
    const label = item.querySelector('.drawer-tag') as HTMLElement;
    expect(label).toHaveAccessibleName('Home');

    const line1 = within(item).getByLabelText(/^Street and number/);
    await user.clear(line1);
    await user.type(line1, '1 Ferry Building');
    expect(lines(label)[0]).toBe('1 Ferry Building');

    await user.click(within(item).getByRole('button', { name: 'Save address' }));
    expect(patch).toHaveBeenCalledWith(
      '/me/addresses/a1',
      expect.objectContaining({ line1: '1 Ferry Building', label: 'Home' }),
    );
  });

  it('lets what is typed take the direction of its own language', async () => {
    answer([]);
    await profile('addresses');
    await screen.findByRole('heading', { name: 'Add address' });
    for (const name of [/^Label/, /^Recipient name/, /^Street and number/, /^City/]) {
      expect(screen.getByLabelText(name)).toHaveAttribute('dir', 'auto');
    }
    // A postal code is always read left to right.
    expect(screen.getByLabelText(/^Postal code/)).toHaveAttribute('dir', 'ltr');
  });
});

describe('the second factor, on cards and a sheet', () => {
  it('has the security tab as the password beside the second factor', async () => {
    answer();
    await profile('security');
    await screen.findByRole('button', { name: /set up two-factor sign-in/i });
    const grid = document.querySelector('.security-grid') as HTMLElement;
    expect(grid.children).toHaveLength(2);
    expect(within(grid).getByRole('heading', { name: 'Change password' })).toBeInTheDocument();
    expect(within(grid).getByRole('heading', { name: 'Two-factor sign-in' })).toBeInTheDocument();
  });

  it('says where it stands on a card: off, then on with what is left of the way back in', async () => {
    answer();
    const { unmount } = await profile('security');
    const off = await screen.findByRole('region', { name: 'Two-factor sign-in' });
    expect(within(off).getByText('Off')).toBeInTheDocument();
    unmount();

    get.mockImplementation(async (path: string) => {
      if (path === '/auth/mfa')
        return { enabled: true, pending: false, required: true, recoveryCodesRemaining: 8 };
      if (path === '/shipping/countries') return COUNTRIES;
      if (path === '/me/addresses') return [];
      return PROFILE;
    });
    await profile('security');
    const on = await screen.findByRole('region', { name: 'Two-factor sign-in' });
    await waitFor(() => expect(within(on).getByText('On')).toBeInTheDocument());
    expect(on).toHaveTextContent('Two-factor sign-in is on');
    expect(on).toHaveTextContent('Recovery codes left: 8');
    expect(on).toHaveTextContent('Your role requires two-factor sign-in');
  });

  it('puts the key on a card, to be scanned or typed, and the codes on a sheet that is a heading of its own', async () => {
    answer();
    post.mockResolvedValueOnce({
      otpauthUri: 'otpauth://x',
      secret: 'JBSWY3DPEHPK3PXP',
      qrCode: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    await profile('security');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /set up two-factor sign-in/i }));

    const key = await screen.findByRole('region', { name: 'Set up two-factor sign-in' });
    expect(within(key).getByRole('img', { name: /qr code/i })).toHaveAttribute(
      'src',
      'data:image/svg+xml;base64,PHN2Zy8+',
    );
    expect(within(key).getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    // The picture is a printed label, white behind black, whichever way the page is.
    expect(key.querySelector('.barcode img')).not.toBeNull();

    const CODES = Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-${String(i).padStart(4, '0')}`);
    post.mockResolvedValueOnce({ recoveryCodes: CODES });
    await user.type(screen.getByLabelText(/code from your authenticator app/i), '654321');
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22');
    await user.click(screen.getByRole('button', { name: /^turn on$/i }));

    const sheet = (
      await screen.findByRole('heading', { level: 3, name: 'Save your recovery codes' })
    ).closest('.drawer-tag') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(Array.from(sheet.querySelectorAll('ol > li')).map((li) => li.textContent)).toEqual(
      CODES,
    );
  });
});
