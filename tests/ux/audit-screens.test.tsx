import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Screens driven as a person drives them.
 *
 * Each case pins something a person meets on a screen: what is in the document,
 * what a control is named, what is disabled and where focus goes. jsdom can say
 * all of that, so these are rendering tests.
 */

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

/* ============================================================
   A field label and its hint
   ============================================================ */

describe('a field is named by its caption alone', () => {
  it('does not fold the hint into the accessible name', () => {
    /**
     * A control associated with its label by NESTING, caption and hint both
     * inside the `<label>`, takes the two run together as its accessible name: a
     * screen reader announces "Owner usernameThe customer's permanent identifier
     * as shown on the parcel" as the NAME of the field. `Field` keeps the hint
     * out of the name.
     */
    renderIn(
      <Field label="Owner username" hint="The customer's permanent identifier.">
        <input />
      </Field>,
    );

    const control = screen.getByLabelText('Owner username', { exact: true });
    expect(control.tagName).toBe('INPUT');
    // The hint is a DESCRIPTION, reachable but not part of the name.
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "The customer's permanent identifier.",
    );
  });

  it('mints its own id, so the same field twice on one page stays unambiguous', () => {
    /**
     * A literal id is wrong the moment the field renders inside a list, because
     * then there are several of it and the label points at the first one.
     */
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

/* ============================================================
   Sign-in: a refusal with a way out
   ============================================================ */

describe('signing in with an address that was never confirmed', () => {
  it('offers to send the link again, where the refusal happened', async () => {
    /**
     * Somebody who lost the confirmation mail is refused at sign-in. "Forgot
     * password" does not help, and "Sign up" answers that the address is already
     * registered, so the way out (`POST /auth/verify-email/resend`) is offered
     * where the refusal happens.
     */
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

/* ============================================================
   Sign-up: every field that gates the button says why
   ============================================================ */

/** The consent box on the sign-up form, by its accessible name. */
const consentBox = () => screen.getByRole('checkbox', { name: /I agree to the Terms of Service/i });

/**
 * Fill the sign-up form. The terms are accepted too unless `consent` is false:
 * a form without consent is one the API refuses, so a test about something else
 * has to tick the box the way a person would.
 */
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
    /**
     * Email and password gate the button like the name fields, so they explain
     * themselves inline too. Otherwise somebody who types `nope` into the address
     * field meets a dead control with no statement of why.
     */
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
    /**
     * Sign-up is the one form in the product that creates an account; without a
     * busy state, two presses would be two registrations.
     */
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

/* ============================================================
   Sign-up: consent to the terms
   ============================================================ */

describe('the sign-up form asks for consent to the terms', () => {
  /**
   * Bault charges fees, accrues interest on a negative balance and suspends
   * accounts, so the form asks for agreement before it creates an account. The
   * box is required, the request carries the version that was shown, and the
   * documents can be read on the form: a signed-out visitor cannot open FAQ &
   * Legal, so a link there would lead nowhere.
   */
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
    // And it says why, beside the box.
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

/* ============================================================
   The confirmation guarding an irreversible action
   ============================================================ */

describe('the confirmation modal', () => {
  it('keeps Tab inside itself', async () => {
    /**
     * The modal guards donating a card and cracking a slab. Without a focus
     * trap, Tab from its last button would move focus into the page behind,
     * where Enter acts on whatever it lands on.
     */
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
    /**
     * Cancel must not stay live while the irreversible thing is already in
     * flight, and the confirm button is the `Button` primitive, so the control
     * that most needs a spinner and `aria-busy` has both.
     */
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

/* ============================================================
   Notification labels
   ============================================================ */

describe('the notification feed speaks the reader’s language', () => {
  it('has a translation for every event the server can emit', () => {
    /**
     * `eventLabel` falls back to the raw event type, so an event without a
     * translation is badged `wallet_request_completed`, `escrow_funded` or
     * `payment_reversed`: the database enum, in both languages.
     */
    const t = (key: string) => key;
    const raw = NOTIFICATION_EVENT_TYPES.filter(
      (e) => eventLabel(t as never, e.key) === e.key,
    ).map((e) => e.key);
    expect(raw).toEqual([]);
  });
});

/* ============================================================
   A button that spends money says what it costs
   ============================================================ */

describe('a button that charges the wallet names the charge', () => {
  it('renders the price beside the label', async () => {
    /**
     * Every service on a card is billed the instant the request is created, so
     * each button in the drawer says what it costs. A price table in the Help
     * section is documentation; the button is where the decision is made.
     */
    const { priceLabel } = await import('../../apps/web/src/shared/servicePrices');
    expect(priceLabel({ actionType: 'service', description: '', model: 'fixed', value: 2000, currency: 'USD' })).toBe(
      '$20.00',
    );
    // A percentage rule stores basis points; running it through the money
    // formatter would turn 5% into "$5.00".
    expect(
      priceLabel({ actionType: 'marketplace_fee', description: '', model: 'percentage', value: 500, currency: 'USD' }),
    ).toBe('5%');
    // A free service says nothing rather than "$0.00", which reads as a bug.
    expect(priceLabel({ actionType: 'shipping', description: '', model: 'fixed', value: 0, currency: 'USD' })).toBeNull();
    expect(priceLabel(undefined)).toBeNull();
  });

  it('maps every card service to the rule it is actually billed under', async () => {
    const { SERVICE_FEE_ACTION } = await import('../../apps/web/src/shared/servicePrices');
    // Mirrors the `feeActionType` each service passes to ServiceRequestService.
    expect(SERVICE_FEE_ACTION.deslab).toBe('service_fee:deslab');
    expect(SERVICE_FEE_ACTION.video).toBe('service_fee:video_review');
    expect(SERVICE_FEE_ACTION.inspection).toBe('service_fee:condition_inspection');
    // Donating a card is not free; it falls to the flat service rate.
    expect(SERVICE_FEE_ACTION.donation).toBe('service');
  });
});

/* ============================================================
   Buttons that mean different things do not look identical
   ============================================================ */

describe('visual weight', () => {
  it('gives the primitive one primary variant, not nine', () => {
    /**
     * Nine primary actions in one list is the same as none: the eye has nothing
     * to land on, and "donate this card forever" would carry the same weight as
     * "take a photo of it".
     */
    renderIn(
      <>
        <Button variant="gold">Primary</Button>
        <Button variant="secondary">Ordinary</Button>
        <Button variant="danger">Irreversible</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Primary' })).toHaveClass('btn--gold');
    expect(screen.getByRole('button', { name: 'Ordinary' })).toHaveClass('btn--secondary');
    expect(screen.getByRole('button', { name: 'Irreversible' })).toHaveClass('btn--danger');
  });
});

/* ============================================================
   The signed-out language control
   ============================================================ */

describe('changing language before signing in', () => {
  it('is an icon with a menu, not the name of the other language', async () => {
    /**
     * A language chooser is the one control that has to be recognisable to
     * somebody who cannot read the page it is on, which means an icon. A text
     * button printing the name of the OTHER language reads as a stray label, and
     * a toggle between two languages cannot grow a third.
     */
    const user = userEvent.setup();
    const { AuthShell } = await import('../../apps/web/src/areas/customer/auth/AuthPage');
    renderIn(
      <AuthShell>
        <p>form</p>
      </AuthShell>,
    );

    // Not a button whose label is a language name.
    expect(screen.queryByRole('button', { name: 'עברית' })).toBeNull();

    const trigger = screen.getByRole('button', { name: /switch language/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    /*
      Every language names itself, in its own script — the only form a reader who
      cannot read the current one can recognise. Matched loosely because the
      selected row also carries a "current" note in its accessible name.
    */
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /עברית/ })).toBeInTheDocument();
    // And the one in force is marked as such, rather than merely coloured.
    expect(within(menu).getByRole('menuitemradio', { checked: true })).toBeInTheDocument();
  });
});

/* ============================================================
   Vocabulary
   ============================================================ */

describe('the words the product uses', () => {
  it('does not call twelve kinds of thing a card', async () => {
    /**
     * The taxonomy holds trading cards, graded slabs, oversized cards, sealed
     * packs, boxes and cases, collection boxes, raw and graded COMICS,
     * memorabilia, small collectibles and "other". Somebody storing a graded
     * comic must not read "No active cards" or "We looked at the card and it
     * matches the description" about their comic.
     */
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    // Strings that genuinely mean a card keep the word: the payment sense, the
    // two item classes that ARE cards, and the name of a real kind of event.
    const allowed = new Set([
      'money.route.card',
      'money.routeDesc.card',
      'wallet.request.funding.card',
      'itemClass.trading_card',
      'itemClass.oversized_card',
      'consign.channel.card_show',
      // The landing page quotes the trading-card intake rule by name, not intake in general.
      'landing.price.intake',
    ]);

    const strays = Object.entries(en)
      .filter(([key, value]) => !allowed.has(key) && /\bcards?\b/i.test(value))
      .map(([key]) => key);
    expect(strays).toEqual([]);
  });

  it('calls putting money in one thing, not three', async () => {
    /**
     * One name for one action. If the tab, the panel inside it and the history
     * table each named it differently, nothing on the page would agree with the
     * tab that led to it.
     */
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    const strays = Object.entries(en)
      .filter(([, value]) => /\btop[- ]?up(s|ped)?\b|\badd (money|funds)\b/i.test(value))
      .map(([key]) => key);
    expect(strays).toEqual([]);

    // And that one name is actually used.
    expect(en['wallet.tab.cash-in']).toBeTruthy();
    expect(en['money.topUp']).toBe('Cash in');
  });
});
