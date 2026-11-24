import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
const navigate = vi.fn();

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    put: vi.fn(),
    del: (...a: unknown[]) => del(...a),
  },
  apiErrorKey: () => null,
  ApiError: FakeApiError,
}));

vi.mock('../../apps/web/src/shared/routing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigate: (...a: unknown[]) => navigate(...a),
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ProfilePage } = await import('../../apps/web/src/areas/customer/profile/ProfilePage');
const { ConfirmEmailPage } = await import('../../apps/web/src/areas/customer/auth/ConfirmEmailPage');

const PROFILE = {
  id: 'u1',
  email: 'red@bault.dev',
  pendingEmail: null as string | null,
  username: 'red',
  role: 'user',
  status: 'active',
  firstName: 'Red',
  lastName: 'Ashwood',
  fullName: 'Red Ashwood',
  nameReviewRequired: false,
  mfaEnabled: false,
  mfaMethod: null as string | null,
  mfaRequired: false,
};

function answer(profile = PROFILE) {
  get.mockImplementation(async (path: string) => {
    if (path === '/me/addresses') return [];
    if (path === '/me/profile') return profile;
    if (path === '/shipping/countries') return [];
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  navigate.mockReset();
  localStorage.clear();
});

async function emailPanel(): Promise<HTMLElement> {
  return (await screen.findByRole('heading', { name: 'Email address' })).closest('section') as HTMLElement;
}

async function details() {
  window.location.hash = '#/profile/details';
  render(
    <I18nProvider>
      <ProfilePage />
    </I18nProvider>,
  );
  await act(async () => {});
}

describe('changing the account email on the profile’s Details', () => {
  it('asks for the new email and the current password, and sends both', async () => {
    answer();
    post.mockResolvedValue({ status: 'confirmation_sent', pendingEmail: 'new@bault.dev' });
    await details();
    const user = userEvent.setup();
    const panel = await emailPanel();
    const send = within(panel).getByRole('button', { name: 'Send confirmation link' });
    expect(send).toBeDisabled();
    expect(within(panel).queryByLabelText(/authenticator/i)).toBeNull();

    await user.type(within(panel).getByLabelText('New email'), ' New@Bault.dev ');
    expect(send).toBeDisabled();
    await user.type(within(panel).getByLabelText('Current password'), 'my password');
    get.mockImplementation(async (path: string) => {
      if (path === '/me/addresses') return [];
      if (path === '/me/profile') return { ...PROFILE, pendingEmail: 'new@bault.dev' };
      throw new Error(`unexpected ${path}`);
    });
    await user.click(send);

    expect(post).toHaveBeenCalledWith('/me/email', { email: 'New@Bault.dev', currentPassword: 'my password' });
    expect(await screen.findByText(/A confirmation link is on its way to new@bault\.dev/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Current password')).toHaveValue('');
  });

  it('says when the new email is the one the account already has, or is not an address', async () => {
    answer();
    await details();
    const user = userEvent.setup();
    const panel = await emailPanel();
    const field = within(panel).getByLabelText('New email');
    await user.type(field, 'red@bault.dev');
    expect(within(panel).getByText('That is already your email address.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'not-an-address');
    expect(within(panel).getByText('Enter a complete email address.')).toBeInTheDocument();
  });

  it('asks for a code from the authenticator app when the account signs in with one', async () => {
    answer({ ...PROFILE, mfaEnabled: true, mfaMethod: 'totp', mfaRequired: true, role: 'warehouse_operator' });
    post.mockResolvedValue({ status: 'confirmation_sent', pendingEmail: 'op@bault.dev' });
    await details();
    const user = userEvent.setup();
    const panel = await emailPanel();
    await user.type(within(panel).getByLabelText('New email'), 'op@bault.dev');
    await user.type(within(panel).getByLabelText('Current password'), 'pw');
    const send = within(panel).getByRole('button', { name: 'Send confirmation link' });
    expect(send).toBeDisabled();
    await user.type(within(panel).getByLabelText('Code from your authenticator app'), '123 456');
    await user.click(send);
    expect(post).toHaveBeenCalledWith('/me/email', {
      email: 'op@bault.dev',
      currentPassword: 'pw',
      code: '123456',
    });
  });

  it('shows the address waiting for confirmation, with Resend and Cancel', async () => {
    answer({ ...PROFILE, pendingEmail: 'next@bault.dev' });
    post.mockResolvedValue({ status: 'confirmation_sent', pendingEmail: 'next@bault.dev' });
    del.mockResolvedValue({ status: 'cancelled' });
    await details();
    const user = userEvent.setup();
    const panel = await emailPanel();
    expect(within(panel).getByText('Waiting for confirmation')).toBeInTheDocument();
    expect(within(panel).getByText(/A confirmation link was sent to next@bault\.dev/)).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Resend' }));
    expect(post).toHaveBeenCalledWith('/me/email/resend', {});
    expect(await screen.findByText(/A new confirmation link is on its way to next@bault\.dev/)).toBeInTheDocument();

    get.mockImplementation(async (path: string) => {
      if (path === '/me/addresses') return [];
      if (path === '/me/profile') return PROFILE;
      throw new Error(`unexpected ${path}`);
    });
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    expect(del).toHaveBeenCalledWith('/me/email');
    expect(await screen.findByText(/The email change was cancelled/)).toBeInTheDocument();
    expect(within(panel).queryByText('Waiting for confirmation')).toBeNull();
  });
});

describe('the page the confirmation link opens', () => {
  async function open(token: string | null) {
    render(
      <I18nProvider>
        <ConfirmEmailPage token={token} />
      </I18nProvider>,
    );
    await act(async () => {});
  }

  it('confirms the token once, says it worked, and sends to sign in', async () => {
    post.mockResolvedValue({ status: 'email_changed', otherSessionsEnded: 2 });
    await open('tok123');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/email/confirm', { token: 'tok123' });
    expect(await screen.findByText(/Your email address has been changed/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(navigate).toHaveBeenCalledWith({ section: 'signin' }, { replace: true });
  });

  it('says a spent or expired link no longer works and where to ask for a new one', async () => {
    post.mockRejectedValue(new FakeApiError(410, 'gone'));
    await open('old');
    expect(await screen.findByText(/This link no longer works/)).toBeInTheDocument();
    expect(screen.getByText(/Profile → Details/)).toBeInTheDocument();
  });

  it('says so when the link has no token', async () => {
    await open(null);
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('This link is missing its confirmation token.')).toBeInTheDocument();
  });
});
