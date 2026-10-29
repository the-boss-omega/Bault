import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const post = vi.fn();
const get = vi.fn();
const patch = vi.fn();
const put = vi.fn();

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
    put: (...a: unknown[]) => put(...a),
    del: vi.fn(),
  },
  ApiError: MockApiError,
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { SignInPage } = await import('../../apps/web/src/areas/customer/auth/SignInPage');
const { SignUpPage } = await import('../../apps/web/src/areas/customer/auth/SignUpPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { Field, Button } = await import('../../apps/web/src/shared/ui/primitives');
const { ConfirmationModal } = await import('../../apps/web/src/shared/ui/DetailDrawer');
const { eventLabel } = await import('../../apps/web/src/shared/notifications');
const { NOTIFICATION_EVENT_TYPES } = await import(
  '../../apps/api/src/modules/not/event-types'
);

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  patch.mockReset();
  put.mockReset();
});

describe('a field is named by its caption alone', () => {
  it('does not fold the hint into the accessible name', () => {
    renderIn(
      <Field label="Owner username" hint="The customer's permanent identifier.">
        <input />
      </Field>,
    );

    const control = screen.getByLabelText('Owner username', { exact: true });
    expect(control.tagName).toBe('INPUT');
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "The customer's permanent identifier.",
    );
  });

  it('mints its own id, so the same field twice on one page stays unambiguous', () => {
    renderIn(
      <>
        <Field label="Amount">
          <input />
        </Field>
        <Field label="Amount">
          <input />
        </Field>
      </>,
    );
    const [first, second] = screen.getAllByLabelText('Amount');
    expect(first!.id).toBeTruthy();
    expect(second!.id).toBeTruthy();
    expect(first!.id).not.toBe(second!.id);
  });

  it('announces an error instead of the hint, and marks it as an alert', () => {
    renderIn(
      <Field label="Password" hint="At least 8 characters." error="At least 8 characters.">
        <input />
      </Field>,
    );
    const control = screen.getByLabelText('Password');
    const describedBy = control.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)).toHaveAttribute('role', 'alert');
  });
});

describe('signing in with an address that was never confirmed', () => {
  it('offers to send the link again, where the refusal happened', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(
      new MockApiError('forbidden', 403, 'Your email address has not been confirmed yet.', 'email_unverified'),
    );
    renderIn(<SignInPage onSignedIn={() => {}} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    const resend = await screen.findByRole('button', { name: /new confirmation link/i });

    post.mockResolvedValueOnce({});
    await user.click(resend);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/verify-email/resend', expect.anything()));
  });

  it('does not offer it for an ordinary wrong password', async () => {
    const user = userEvent.setup();
    post.mockRejectedValueOnce(new MockApiError('unauthenticated', 401, 'Invalid credentials', 'unauthenticated'));
    renderIn(<SignInPage onSignedIn={() => {}} onGoToSignUp={() => {}} onGoToForgotPassword={() => {}} />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/invalid credentials/i);
    expect(screen.queryByRole('button', { name: /new confirmation link/i })).toBeNull();
  });
});

const consentBox = () => screen.getByRole('checkbox', { name: /I agree to the Terms of Service/i });

async function fillSignUp(
  user: ReturnType<typeof userEvent.setup>,
  over: Record<string, string> = {},
  consent = true,
) {
  const values = {
    Email: 'ann@example.com',
    Username: 'annlee',
    'First name': 'Ann',
    'Last name': 'Lee',
    Password: 'correct horse',
    ...over,
  };
  for (const [label, value] of Object.entries(values)) {
    if (value === '') continue;
    await user.type(screen.getByLabelText(label, { exact: true }), value);
  }
  if (consent) await user.click(consentBox());
}

describe('the sign-up form explains every field it blocks on', () => {
  const fill = fillSignUp;

  it('says what is wrong with the address rather than only disabling the button', async () => {
    const user = userEvent.setup();
    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    await fill(user, { Email: 'nope' });

    expect(screen.getByText(/does not look like an email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });

  it('says the password is too short, and how short is too short', async () => {
    const user = userEvent.setup();
    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    await fill(user, { Password: 'abc' });

    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });

  it('cannot be submitted twice by pressing it twice', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    post.mockReturnValueOnce(new Promise((r) => (release = r)));

    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    await fill(user);

    const submit = screen.getByRole('button', { name: 'Sign up' });
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');

    release({ username: 'annlee', firstName: 'Ann', lastName: 'Lee' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });
});

describe('the sign-up form asks for consent to the terms', () => {
  it('cannot be submitted until the terms are accepted', async () => {
    const { TERMS_VERSION } = await import('../../apps/web/src/areas/customer/help/legalContent');
    const user = userEvent.setup();
    post.mockResolvedValueOnce({ username: 'annlee', firstName: 'Ann', lastName: 'Lee' });
    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    await fillSignUp(user, {}, false);

    const submit = screen.getByRole('button', { name: 'Sign up' });
    expect(consentBox()).not.toBeChecked();
    expect(consentBox()).toBeRequired();
    expect(submit).toBeDisabled();
    expect(screen.getByText(/the version you accept, and when, is recorded/i)).toBeInTheDocument();

    await user.click(consentBox());
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      '/auth/register',
      expect.objectContaining({ acceptedTermsVersion: TERMS_VERSION, username: 'annlee' }),
    );
  });

  it('shows the documents on the form, each marked as an unreviewed draft', async () => {
    const user = userEvent.setup();
    renderIn(<SignUpPage onGoToSignIn={() => {}} />);
    expect(screen.queryByRole('heading', { name: 'Terms of Service' })).toBeNull();

    await user.click(screen.getByRole('button', { name: /read them/i }));
    for (const title of ['Terms of Service', 'Privacy Policy', 'Cookie notice']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText('DRAFT — must be reviewed by a lawyer before launch')).toHaveLength(3);
  });
});

describe('the confirmation modal', () => {
  it('keeps Tab inside itself', async () => {
    const user = userEvent.setup();
    renderIn(
      <>
        <button type="button">Behind the modal</button>
        <ConfirmationModal
          title="Donate this card"
          body={<p>This cannot be undone.</p>}
          confirmLabel="Donate"
          cancelLabel="Cancel"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </>,
    );

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('disables Cancel while the confirmed action is running', () => {
    renderIn(
      <ConfirmationModal
        title="Donate this card"
        body={<p>This cannot be undone.</p>}
        confirmLabel="Donate"
        cancelLabel="Cancel"
        busy
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Donate' })).toHaveAttribute('aria-busy', 'true');
  });

  it('does not close on a backdrop click while busy', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { container } = renderIn(
      <ConfirmationModal
        title="Donate this card"
        body={<p>This cannot be undone.</p>}
        confirmLabel="Donate"
        cancelLabel="Cancel"
        busy
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await user.click(container.querySelector('.modal-backdrop')!);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('the notification feed speaks the reader’s language', () => {
  it('has a translation for every event the server can emit', () => {
    const t = (key: string) => key;
    const raw = NOTIFICATION_EVENT_TYPES.filter(
      (e) => eventLabel(t as never, e.key) === e.key,
    ).map((e) => e.key);
    expect(raw).toEqual([]);
  });
});

describe('a button that charges the wallet names the charge', () => {
  it('renders the price beside the label', async () => {
    const { priceLabel } = await import('../../apps/web/src/shared/servicePrices');
    expect(priceLabel({ actionType: 'service', description: '', model: 'fixed', value: 2000, currency: 'USD' })).toBe(
      '$20.00',
    );
    expect(
      priceLabel({ actionType: 'marketplace_fee', description: '', model: 'percentage', value: 500, currency: 'USD' }),
    ).toBe('5%');
    expect(priceLabel({ actionType: 'shipping', description: '', model: 'fixed', value: 0, currency: 'USD' })).toBeNull();
    expect(priceLabel(undefined)).toBeNull();
  });

  it('maps every card service to the rule it is actually billed under', async () => {
    const { SERVICE_FEE_ACTION } = await import('../../apps/web/src/shared/servicePrices');
    expect(SERVICE_FEE_ACTION.deslab).toBe('service_fee:deslab');
    expect(SERVICE_FEE_ACTION.video).toBe('service_fee:video_review');
    expect(SERVICE_FEE_ACTION.inspection).toBe('service_fee:condition_inspection');
    expect(SERVICE_FEE_ACTION.donation).toBe('service');
  });
});

describe('visual weight', () => {
  it('gives the primitive one primary variant, and the rest are lines', () => {
    renderIn(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Ordinary</Button>
        <Button variant="danger">Irreversible</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('btn--primary');
    expect(screen.getByRole('button', { name: 'Ordinary' })).toHaveClass('btn--secondary');
    expect(screen.getByRole('button', { name: 'Irreversible' })).toHaveClass('btn--danger');
  });
});

describe('changing language before signing in', () => {
  it('is an icon with a menu, not the name of the other language', async () => {
    const user = userEvent.setup();
    const { AuthShell } = await import('../../apps/web/src/areas/customer/auth/AuthPage');
    renderIn(
      <AuthShell>
        <p>form</p>
      </AuthShell>,
    );

    expect(screen.queryByRole('button', { name: 'עברית' })).toBeNull();

    const trigger = screen.getByRole('button', { name: /switch language/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /עברית/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { checked: true })).toBeInTheDocument();
  });
});

describe('the words the product uses', () => {
  it('does not call twelve kinds of thing a card', async () => {
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    const allowed = new Set([
      'money.route.card',
      'money.routeDesc.card',
      'wallet.request.funding.card',
      'itemClass.trading_card',
      'itemClass.oversized_card',
      'consign.channel.card_show',
      'landing.price.intake',
    ]);

    const strays = Object.entries(en)
      .filter(([key, value]) => !allowed.has(key) && /\bcards?\b/i.test(value))
      .map(([key]) => key);
    expect(strays).toEqual([]);
  });

  it('calls putting money in one thing, not three', async () => {
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    const strays = Object.entries(en)
      .filter(([, value]) => /\btop[- ]?up(s|ped)?\b|\badd (money|funds)\b/i.test(value))
      .map(([key]) => key);
    expect(strays).toEqual([]);

    expect(en['wallet.tab.cash-in']).toBeTruthy();
    expect(en['money.topUp']).toBe('Cash in');
  });
});
