import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

describe('signing in with a second factor', () => {
  it('asks for the code after a right password, and signs in with the challenge and the code', async () => {
    const user = userEvent.setup();
    const onSignedIn = await reachSecondStep(user);
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
    expect(screen.getByRole('heading', { name: /two-factor sign-in/i })).toBeInTheDocument();

    post.mockRejectedValueOnce(new MockApiError('unauthenticated', 401, 'expired', 'mfa_challenge_expired'));
    await user.clear(code);
    await user.type(code, '111111');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});

const OFF = {
  enabled: false,
  pending: false,
  method: null,
  pendingMethod: null,
  methods: ['email', 'totp'],
  email: 'red@bault.dev',
  required: false,
  recoveryCodesRemaining: 0,
};
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
    await user.click(await screen.findByRole('radio', { name: /authenticator app/i }));
    await user.click(screen.getByRole('button', { name: /set up two-factor sign-in/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/setup', { method: 'totp' });

    const qr = await screen.findByRole('img', { name: /qr code/i });
    expect(qr).toHaveAttribute('src', 'data:image/svg+xml;base64,PHN2Zy8+');
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/code from your authenticator app/i), '654321');
    const turnOn = screen.getByRole('button', { name: /^turn on$/i });
    expect(turnOn).toBeDisabled();
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22');
    post.mockResolvedValueOnce({ status: 'enabled', recoveryCodes: CODES, otherSessionsEnded: 0 });
    get.mockResolvedValue({ enabled: true, pending: false, required: false, recoveryCodesRemaining: 10 });
    await user.click(turnOn);
    expect(post).toHaveBeenLastCalledWith('/auth/mfa/confirm', { method: 'totp', code: '654321', password: 'hunter22' });

    expect(await screen.findByRole('heading', { name: /save your recovery codes/i })).toBeInTheDocument();
    for (const c of CODES) expect(screen.getByText(c)).toBeInTheDocument();
    const done = screen.getByRole('button', { name: /^done$/i });
    expect(done).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /i have saved these codes/i }));
    expect(done).toBeEnabled();
    await user.click(done);

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

const EMAIL_ON = { ...OFF, enabled: true, method: 'email', recoveryCodesRemaining: 8 };

describe('emailed codes on the account-security screen', () => {
  it('offers emailed codes first and chosen, and the app beside them, each said in a line', async () => {
    get.mockResolvedValue(OFF);
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    const email = await screen.findByRole('radio', { name: /email me a code/i });
    const app = screen.getByRole('radio', { name: /authenticator app/i });
    expect(email).toBeChecked();
    expect(app).not.toBeChecked();
    expect(screen.getByRole('group', { name: /how should card embassy ask/i })).toBeInTheDocument();
    expect(screen.getByText(/red@bault\.dev/)).toBeInTheDocument();
  });

  it('enrols by email: a code to the address, then the password and the code, then the recovery codes', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(OFF);
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);

    post.mockResolvedValueOnce({ method: 'email', email: 'red@bault.dev', resendAfterSeconds: 60 });
    get.mockResolvedValue({ ...OFF, pending: true, pendingMethod: 'email' });
    await user.click(await screen.findByRole('button', { name: /set up two-factor sign-in/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/setup', { method: 'email' });

    expect(await screen.findByText(/we emailed a 6-digit code to red@bault\.dev/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /qr code/i })).toBeNull();
    const code = screen.getByLabelText(/code from the email/i);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeDisabled();

    await user.type(code, '012 345');
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22');
    post.mockResolvedValueOnce({ status: 'enabled', recoveryCodes: CODES, otherSessionsEnded: 0 });
    get.mockResolvedValue({ ...EMAIL_ON, recoveryCodesRemaining: 10 });
    await user.click(screen.getByRole('button', { name: /^turn on$/i }));
    expect(post).toHaveBeenLastCalledWith('/auth/mfa/confirm', { method: 'email', code: '012345', password: 'hunter22' });

    expect(await screen.findByRole('heading', { name: /save your recovery codes/i })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /i have saved these codes/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(await screen.findByText(/a code we email to red@bault\.dev/i)).toBeInTheDocument();
  });

  it('comes back to the code, not the choice, when a setup by email was left half done', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ ...OFF, pending: true, pendingMethod: 'email' });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);

    expect(await screen.findByLabelText(/code from the email/i)).toBeInTheDocument();
    const resend = screen.getByRole('button', { name: /send a new code/i });
    expect(resend).toBeEnabled();
    post.mockResolvedValueOnce({ status: 'code_sent', email: 'red@bault.dev', resendAfterSeconds: 60 });
    await user.click(resend);
    expect(post).toHaveBeenCalledWith('/auth/mfa/email/code');
    expect(await screen.findByText(/a new code is on its way to red@bault\.dev/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeDisabled();
    expect(screen.getByText(/you can ask for another code in \d+ s/i)).toBeInTheDocument();
  });

  it('says why a new code was refused', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ ...OFF, pending: true, pendingMethod: 'email' });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    post.mockRejectedValueOnce(new MockApiError('client', 429, 'Wait 42 seconds before asking for another code.', 'rate_limited'));
    await user.click(await screen.findByRole('button', { name: /send a new code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait 42 seconds/i);
  });

  it('says where the codes go once it is on, and turns it off with the password and a code mailed for it', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(EMAIL_ON);
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    expect(await screen.findByText(/a code we email to red@bault\.dev/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^turn off$/i }));
    post.mockResolvedValueOnce({ status: 'code_sent', email: 'red@bault.dev', resendAfterSeconds: 60 });
    await user.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/email/code');
    await user.type(screen.getByLabelText(/^password$/i), 'hunter2-long');
    await user.type(await screen.findByLabelText(/code from the email/i), '246810');
    post.mockResolvedValueOnce({ status: 'disabled' });
    get.mockResolvedValue(OFF);
    await user.click(screen.getByRole('button', { name: /turn off two-factor sign-in/i }));
    expect(post).toHaveBeenLastCalledWith('/auth/mfa/disable', { password: 'hunter2-long', code: '246810' });
    expect(await screen.findByRole('button', { name: /set up two-factor sign-in/i })).toBeInTheDocument();
  });

  it('replaces the recovery codes for a code mailed for it', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(EMAIL_ON);
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    await user.click(await screen.findByRole('button', { name: /new recovery codes/i }));
    post.mockResolvedValueOnce({ status: 'code_sent', email: 'red@bault.dev', resendAfterSeconds: 60 });
    await user.click(screen.getByRole('button', { name: /email me a code/i }));
    await user.type(await screen.findByLabelText(/code from the email/i), '135790');
    post.mockResolvedValueOnce({ recoveryCodes: CODES });
    await user.click(screen.getByRole('button', { name: /make new codes/i }));
    expect(post).toHaveBeenLastCalledWith('/auth/mfa/recovery-codes', { code: '135790' });
    expect(await screen.findByText(CODES[9]!)).toBeInTheDocument();
  });

  it('offers only the app to a role that must use it', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ ...OFF, required: true, methods: ['totp'] });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    const setup = await screen.findByRole('button', { name: /set up two-factor sign-in/i });
    expect(screen.queryByRole('radio', { name: /email me a code/i })).toBeNull();
    post.mockResolvedValueOnce({ otpauthUri: 'otpauth://totp/x', secret: 'JBSWY3DPEHPK3PXP', qrCode: 'data:image/svg+xml;base64,PHN2Zy8+' });
    await user.click(setup);
    expect(post).toHaveBeenCalledWith('/auth/mfa/setup', { method: 'totp' });
  });

  it('tells a member of staff whose codes come by email that the role needs the app, and sets the app up', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue({ ...EMAIL_ON, required: true, methods: ['totp'] });
    const { TwoFactorPanel } = await panel();
    renderIn(<TwoFactorPanel />);
    expect(await screen.findByText(/your role signs in with an authenticator app/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^turn off$/i })).toBeNull();
    post.mockResolvedValueOnce({ otpauthUri: 'otpauth://totp/x', secret: 'JBSWY3DPEHPK3PXP', qrCode: 'data:image/svg+xml;base64,PHN2Zy8+' });
    await user.click(screen.getByRole('button', { name: /set up an authenticator app/i }));
    expect(post).toHaveBeenCalledWith('/auth/mfa/setup', { method: 'totp' });
    expect(await screen.findByRole('img', { name: /qr code/i })).toBeInTheDocument();
  });
});

const EMAIL_CHALLENGE = {
  status: 'mfa_required',
  challengeToken: 'tok-9',
  expiresAt: '2099-01-01T00:00:00.000Z',
  method: 'email',
  codeSent: true,
  sentTo: 'r•••@bault.dev',
  resendAfterSeconds: 0,
};

async function reachEmailStep(user: ReturnType<typeof userEvent.setup>, challenge: Record<string, unknown> = EMAIL_CHALLENGE) {
  const onSignedIn = vi.fn();
  post.mockResolvedValueOnce(challenge);
  renderIn(<SignInPage onSignedIn={onSignedIn} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  await screen.findByRole('heading', { name: /two-factor sign-in/i });
  return onSignedIn;
}

describe('signing in with an emailed code', () => {
  it('says where the code went, takes it, and signs in', async () => {
    const user = userEvent.setup();
    const onSignedIn = await reachEmailStep(user);
    expect(screen.getByText(/we emailed a 6-digit code to r•••@bault\.dev/i)).toBeInTheDocument();
    const code = screen.getByLabelText(/code from the email/i);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    await user.type(code, '123 456');
    post.mockResolvedValueOnce({ id: 'u1', role: 'user', mfaEnrollmentRequired: false });
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(post).toHaveBeenLastCalledWith('/auth/login/mfa', { challengeToken: 'tok-9', code: '123456' });
  });

  it('sends a new code on request, says so, and makes the next request wait', async () => {
    const user = userEvent.setup();
    await reachEmailStep(user);
    post.mockResolvedValueOnce({ status: 'code_sent', sentTo: 'r•••@bault.dev', resendAfterSeconds: 60 });
    await user.click(screen.getByRole('button', { name: /send a new code/i }));
    expect(post).toHaveBeenLastCalledWith('/auth/login/mfa/resend', { challengeToken: 'tok-9' });
    const said = await screen.findByText(/a new code is on its way to r•••@bault\.dev/i);
    expect(said.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeDisabled();
    expect(screen.getByText(/you can ask for another code in \d+ s/i)).toBeInTheDocument();
  });

  it('says a spent code is spent and stays on the step, so a new one can be asked for', async () => {
    const user = userEvent.setup();
    await reachEmailStep(user);
    post.mockRejectedValueOnce(
      new MockApiError('unauthenticated', 401, 'This code was entered wrongly too many times. Send a new code.', 'mfa_code_expired'),
    );
    await user.type(screen.getByLabelText(/code from the email/i), '000000');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/send a new code/i);
    expect(screen.getByRole('heading', { name: /two-factor sign-in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send a new code/i })).toBeEnabled();
  });

  it('says why a new code was refused, and sends a timed-out sign-in back to the password', async () => {
    const user = userEvent.setup();
    await reachEmailStep(user);
    post.mockRejectedValueOnce(new MockApiError('client', 429, 'A code was sent less than a minute ago. Wait 42 seconds.', 'rate_limited'));
    await user.click(screen.getByRole('button', { name: /send a new code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/wait 42 seconds/i);

    post.mockRejectedValueOnce(new MockApiError('unauthenticated', 401, 'expired', 'mfa_challenge_expired'));
    await user.click(screen.getByRole('button', { name: /send a new code/i }));
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('says when no code could be sent, and still offers a recovery code', async () => {
    const user = userEvent.setup();
    await reachEmailStep(user, { ...EMAIL_CHALLENGE, codeSent: false, sentTo: null, resendAfterSeconds: 0 });
    expect(screen.getByText(/we did not send a code just now/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
    expect(screen.getByLabelText(/^recovery code$/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use the emailed code/i }));
    expect(screen.getByLabelText(/code from the email/i)).toBeInTheDocument();
  });
});

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
    const asked = get.mock.calls.map((c) => c[0]);
    expect(asked.filter((p) => p !== '/me/profile' && p !== '/auth/mfa')).toEqual([]);
  });
});

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
  /** An account is opened by a link that names it, as the roll's names do. */
  async function openAccount(id: string) {
    adminApi();
    window.location.hash = `#/admin/users?user=${id}`;
    renderIn(<AdminConsole currentUserId="me" />);
    return screen.findByRole('dialog');
  }

  it('is offered for another enrolled account, and asks first', async () => {
    const user = userEvent.setup();
    const drawer = await openAccount('u2');
    expect(drawer).toHaveTextContent('hermon@bault.dev');

    post.mockResolvedValueOnce({ status: 'mfa_reset', sessionsEnded: 2 });
    await user.click(within(drawer).getByRole('button', { name: /reset two-factor/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset two-factor sign-in' });
    expect(dialog).toHaveTextContent(/hermon@bault\.dev/);
    expect(post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /^reset$/i }));
    expect(post).toHaveBeenCalledWith('/admin/users/u2/mfa/reset');
    // Said in the drawer (inside the dialog, where it is seen and read out) and on the page behind it.
    const said = await within(drawer).findByText(/sessions ended: 2/i);
    expect(said.closest('[role="status"]')).not.toBeNull();
    expect(screen.getAllByText(/sessions ended: 2/i)).toHaveLength(2);
  });

  it('leaves the keyboard in the drawer when what it asked is gone: the button was the thing the reset removed', async () => {
    const user = userEvent.setup();
    const drawer = await openAccount('u2');
    post.mockResolvedValueOnce({ status: 'mfa_reset', sessionsEnded: 2 });
    await user.click(within(drawer).getByRole('button', { name: /reset two-factor/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset two-factor sign-in' });
    await user.click(within(dialog).getByRole('button', { name: /^reset$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset two-factor sign-in' })).toBeNull());
    // The account no longer has a second factor, so there is nothing to reset, and no button to give focus back to.
    expect(within(drawer).queryByRole('button', { name: /reset two-factor/i })).toBeNull();
    await waitFor(() => expect(drawer).toHaveFocus());
  });

  it('says in the drawer why a reset was refused', async () => {
    const user = userEvent.setup();
    const drawer = await openAccount('u2');
    post.mockRejectedValueOnce(new Error('That account has no second factor.'));
    await user.click(within(drawer).getByRole('button', { name: /reset two-factor/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset two-factor sign-in' });
    await user.click(within(dialog).getByRole('button', { name: /^reset$/i }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('That account has no second factor.');
    // Still enrolled as far as anyone knows: the button is still there.
    expect(within(drawer).getByRole('button', { name: /reset two-factor/i })).toBeInTheDocument();
  });

  it('is never offered for your own account', async () => {
    const drawer = await openAccount('me');
    expect(drawer).toHaveTextContent('eldar@bault.dev');
    expect(within(drawer).queryByRole('button', { name: /reset two-factor/i })).toBeNull();
  });

  it('is not offered for an account that has no second factor to reset', async () => {
    const drawer = await openAccount('u3');
    expect(drawer).toHaveTextContent('red@bault.dev');
    expect(within(drawer).queryByRole('button', { name: /reset two-factor/i })).toBeNull();
  });
});

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
    expect(await screen.findByText('Wrong code', { ignore: 'option' })).toBeInTheDocument();
    expect(screen.getByText(/password right — code asked for/i, { ignore: 'option' })).toBeInTheDocument();
  });
});
