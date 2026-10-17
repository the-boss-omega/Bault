import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Two-factor sign-in, as a person meets it: the second step at sign-in, the
 * account-security screen that enrols, the screen a member of staff is held on
 * until they have, and the administrator's reset.
 *
 * `api` is mocked at the module boundary, as in `auth.test.tsx`: the contract
 * pinned is "call the API this way, render what comes back".
 */

const post = vi.fn();
const get = vi.fn();
const patch = vi.fn();

class MockApiError extends Error {
  constructor(
    readonly kind: string,
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: MockApiError,
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { SignInPage } = await import('../../apps/web/src/areas/customer/auth/SignInPage');
// These screens are imported where they are used, so a missing module fails
// only the cases that need it and the rest fail on what they assert.
// (`@vite-ignore` with the path in a variable: Vite otherwise resolves a dynamic
// import while transforming the file, which fails the whole file just the same.)
const lazy = <T,>(path: string) => import(/* @vite-ignore */ path) as Promise<T>;
const panel = () =>
  lazy<typeof import('../../apps/web/src/areas/customer/profile/TwoFactorPanel')>(
    '../../apps/web/src/areas/customer/profile/TwoFactorPanel',
  );
const forced = () =>
  lazy<typeof import('../../apps/web/src/areas/customer/auth/ForcedEnrollmentPage')>(
    '../../apps/web/src/areas/customer/auth/ForcedEnrollmentPage',
  );
const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { SignInsSection } = await import('../../apps/web/src/areas/admin/SignInsSection');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  patch.mockReset();
  window.location.hash = '';
});

const CHALLENGE = { status: 'mfa_required', challengeToken: 'tok-123', expiresAt: '2099-01-01T00:00:00.000Z' };

async function reachSecondStep(user: ReturnType<typeof userEvent.setup>, onSignedIn = vi.fn()) {
  post.mockResolvedValueOnce(CHALLENGE);
  renderIn(<SignInPage onSignedIn={onSignedIn} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  await screen.findByRole('heading', { name: /two-factor sign-in/i });
  return onSignedIn;
}

/* ============================================================
   The second step
   ============================================================ */

describe('signing in with a second factor', () => {
  it('asks for the code after a right password, and signs in with the challenge and the code', async () => {
    const user = userEvent.setup();
    const onSignedIn = await reachSecondStep(user);
    // The password step did not sign anybody in.
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    const code = screen.getByLabelText(/code from your authenticator app/i);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    await user.type(code, '123 456');

    post.mockResolvedValueOnce({ id: 'u1', role: 'admin', mfaEnrollmentRequired: false });
    await user.click(screen.getByRole('button', { name: /^verify$/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1', role: 'admin', mfaEnrollmentRequired: false }));
    expect(post).toHaveBeenLastCalledWith('/auth/login/mfa', { challengeToken: 'tok-123', code: '123456' });
  });

  it('takes a recovery code instead, when asked to', async () => {
    const user = userEvent.setup();
    await reachSecondStep(user);
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
    await user.type(screen.getByLabelText(/^recovery code$/i), 'abcd-efgh-jkmn');

    post.mockResolvedValueOnce({ id: 'u1', role: 'user', mfaEnrollmentRequired: false });
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/auth/login/mfa', { challengeToken: 'tok-123', recoveryCode: 'abcd-efgh-jkmn' }),
    );
  });

  it('says a wrong code is wrong, and sends a timed-out sign-in back to the password', async () => {
    const user = userEvent.setup();
    await reachSecondStep(user);
    const code = screen.getByLabelText(/code from your authenticator app/i);

    post.mockRejectedValueOnce(new MockApiError('unauthenticated', 401, 'That code is not right.', 'mfa_code_invalid'));
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText(/that code is not right/i)).toBeInTheDocument();
    // Still on the second step: a mistyped code is not a reason to retype the password.
    expect(screen.getByRole('heading', { name: /two-factor sign-in/i })).toBeInTheDocument();

    post.mockRejectedValueOnce(new MockApiError('unauthenticated', 401, 'expired', 'mfa_challenge_expired'));
    await user.clear(code);
    await user.type(code, '111111');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});

/* ============================================================
   Account security
   ============================================================ */

const OFF = { enabled: false, pending: false, required: false, recoveryCodesRemaining: 0 };
const CODES = Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-${String(i).padStart(4, '0')}`);

describe('the account-security screen', () => {
  it('enrols: a QR code and a key to type, a code to confirm, then the recovery codes — once', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(OFF);
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);

    post.mockResolvedValueOnce({
      otpauthUri: 'otpauth://totp/Bault:red?secret=JBSWY3DPEHPK3PXP',
      secret: 'JBSWY3DPEHPK3PXP',
      qrCode: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    await user.click(await screen.findByRole('button', { name: /set up two-factor sign-in/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/setup');

    const qr = await screen.findByRole('img', { name: /qr code/i });
    expect(qr).toHaveAttribute('src', 'data:image/svg+xml;base64,PHN2Zy8+');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/code from your authenticator app/i), '654321');
    // The password too: a session alone must not be enough to enrol a phone.
    const turnOn = screen.getByRole('button', { name: /^turn on$/i });
    expect(turnOn).toBeDisabled();
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22');
    post.mockResolvedValueOnce({ status: 'enabled', recoveryCodes: CODES, otherSessionsEnded: 0 });
    get.mockResolvedValue({ enabled: true, pending: false, required: false, recoveryCodesRemaining: 10 });
    await user.click(turnOn);
    expect(post).toHaveBeenLastCalledWith('/auth/mfa/confirm', { code: '654321', password: 'hunter22' });

    // Every code, and a step that cannot be skipped by accident.
    expect(await screen.findByRole('heading', { name: /save your recovery codes/i })).toBeInTheDocument();
    for (const c of CODES) expect(screen.getByText(c)).toBeInTheDocument();
    const done = screen.getByRole('button', { name: /^done$/i });
    expect(done).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /i have saved these codes/i }));
    expect(done).toBeEnabled();
    await user.click(done);

    // Gone from the screen, and not coming back.
    await waitFor(() => expect(screen.queryByText(CODES[0]!)).not.toBeInTheDocument());
    expect(await screen.findByText(/recovery codes left: 10/i)).toBeInTheDocument();
  });

  it('turns it off with the password and a current code, where the role allows', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ enabled: true, pending: false, required: false, recoveryCodesRemaining: 7 });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);

    await user.click(await screen.findByRole('button', { name: /^turn off$/i }));
    await user.type(screen.getByLabelText(/^password$/i), 'hunter2-long');
    await user.type(screen.getByLabelText(/code from your authenticator app/i), '246810');
    post.mockResolvedValueOnce({ status: 'disabled' });
    get.mockResolvedValue(OFF);
    await user.click(screen.getByRole('button', { name: /turn off two-factor sign-in/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/disable', { password: 'hunter2-long', code: '246810' });
    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
  });

  it('does not offer to turn it off when the role requires it, and says why', async () => {
    get.mockResolvedValue({ enabled: true, pending: false, required: true, recoveryCodesRemaining: 10 });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    expect(await screen.findByText(/your role requires two-factor sign-in/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^turn off$/i })).toBeNull();
  });

  it('replaces the recovery codes for a current code, and shows the new set once', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ enabled: true, pending: false, required: true, recoveryCodesRemaining: 2 });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    await user.click(await screen.findByRole('button', { name: /new recovery codes/i }));
    await user.type(screen.getByLabelText(/code from your authenticator app/i), '135790');
    post.mockResolvedValueOnce({ recoveryCodes: CODES });
    await user.click(screen.getByRole('button', { name: /make new codes/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/recovery-codes', { code: '135790' });
    expect(await screen.findByText(CODES[9]!)).toBeInTheDocument();
  });
});

/* ============================================================
   Staff who must enrol
   ============================================================ */

describe('a member of staff who has not enrolled', () => {
  it('is told why, can enrol from there, and can always sign out', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ enabled: false, pending: false, required: true, recoveryCodesRemaining: 0 });
    const onSignOut = vi.fn();
    const { ForcedEnrollmentPage } = await forced();
    renderIn(<ForcedEnrollmentPage onEnrolled={vi.fn()} onSignOut={onSignOut} />);

    expect(screen.getByRole('heading', { name: /set up two-factor sign-in to continue/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('the app shell', () => {
  it('holds an administrator who must enrol on the enrolment screen, and asks the console for nothing', async () => {
    const { default: App } = await import('../../apps/web/src/App');
    get.mockImplementation(async (path: string) => {
      if (path === '/me/profile') {
        return {
          id: 'me', role: 'admin', status: 'active', email: 'new-admin@bault.dev', username: 'newadmin',
          firstName: 'New', lastName: 'Admin', fullName: 'New Admin', nameReviewRequired: false,
          mfaRequired: true, mfaEnabled: false,
        };
      }
      if (path === '/auth/mfa') return { enabled: false, pending: false, required: true, recoveryCodesRemaining: 0 };
      throw new Error(`the shell asked for ${path}`);
    });
    window.location.hash = '#/admin';
    renderIn(<App />);

    expect(await screen.findByRole('heading', { name: /set up two-factor sign-in to continue/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
    // Every one of these would have been refused with `mfa_enrollment_required`.
    const asked = get.mock.calls.map((c) => c[0]);
    expect(asked.filter((p) => p !== '/me/profile' && p !== '/auth/mfa')).toEqual([]);
  });
});

/* ============================================================
   The administrator's reset
   ============================================================ */

const USERS = [
  { id: 'me', email: 'eldar@bault.dev', username: 'eldar', firstName: 'Eldar', lastName: 'A', nameReviewRequired: false, role: 'admin', status: 'active', intakeId: null, mfaEnabled: true },
  { id: 'u2', email: 'hermon@bault.dev', username: 'hermon', firstName: 'Hermon', lastName: 'B', nameReviewRequired: false, role: 'warehouse_operator', status: 'active', intakeId: null, mfaEnabled: true },
  { id: 'u3', email: 'red@bault.dev', username: 'red', firstName: 'Red', lastName: 'C', nameReviewRequired: false, role: 'user', status: 'active', intakeId: null, mfaEnabled: false },
];

function adminApi(parked: unknown[] = []) {
  get.mockImplementation(async (path: string) => {
    if (path === '/admin/users') return USERS;
    if (path === '/admin/items') return [];
    if (path === '/admin/outbox/parked') return parked;
    return [];
  });
}

describe("resetting somebody else's second factor", () => {
  it('is offered for another enrolled account, never for your own, and asks first', async () => {
    const user = userEvent.setup();
    adminApi();
    window.location.hash = '#/admin/users';
    renderIn(<AdminConsole currentUserId="me" />);

    const buttons = await screen.findAllByRole('button', { name: /reset two-factor/i });
    // Hermon only: not the administrator's own row, not an account without it.
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.closest('tr')).toHaveTextContent('hermon@bault.dev');

    post.mockResolvedValueOnce({ status: 'mfa_reset', sessionsEnded: 2 });
    await user.click(buttons[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/hermon@bault\.dev/);
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /^reset$/i }));
    expect(post).toHaveBeenCalledWith('/admin/users/u2/mfa/reset');
    expect(await screen.findByText(/sessions ended: 2/i)).toBeInTheDocument();
  });
});

/* ============================================================
   The sign-in log
   ============================================================ */

describe('the sign-in log', () => {
  it('names the two-step outcomes', async () => {
    get.mockResolvedValue({
      since: '2026-10-15T00:00:00.000Z',
      last24h: { successes: 1, failures: 1, failingAddresses: 1 },
      suspicious: [],
      attempts: [
        { id: 'a1', occurredAt: '2026-10-15T12:00:01.000Z', outcome: 'mfa_failed', identifier: 'eldar', userId: 'u', ip: '203.0.113.7', userAgent: null, username: 'eldar', email: 'eldar@bault.dev', role: 'admin' },
        { id: 'a2', occurredAt: '2026-10-15T12:00:00.000Z', outcome: 'mfa_challenged', identifier: 'eldar', userId: 'u', ip: '203.0.113.7', userAgent: null, username: 'eldar', email: 'eldar@bault.dev', role: 'admin' },
      ],
    });
    renderIn(<SignInsSection onError={() => {}} />);
    expect(await screen.findByText('Wrong code')).toBeInTheDocument();
    expect(screen.getByText(/password right — code asked for/i)).toBeInTheDocument();
  });
});
