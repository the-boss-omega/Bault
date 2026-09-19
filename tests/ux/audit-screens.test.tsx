import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The screens changed by the end-to-end UX audit, driven as a person drives them.
 *
 * Every case here pins a defect that was found by using the product rather than
 * by reading it, and each names the thing that was wrong. They are rendering
 * tests: jsdom can say what is in the document, what a control is named, what is
 * disabled and where focus went — which is exactly what these defects were about.
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
   The field label that swallowed its own hint
   ============================================================ */

describe('a field is named by its caption alone', () => {
  it('does not fold the hint into the accessible name', () => {
    /**
     * The pattern this replaces was `<label class="field"><span
     * class="field-label">Caption</span><input/><span class="field-hint">Help
     * text</span></label>` — the control associated with its label by NESTING,
     * so the accessible name became the caption AND the hint run together. A
     * screen reader announced "Owner usernameThe customer's permanent identifier
     * as shown on the parcel" as the NAME of the field.
     *
     * Forty fields across fifteen files were built that way. `Field` was written
     * to fix it and had been applied to two of them.
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
     * `htmlFor` used to be required, which meant every conversion had to invent
     * an id — and a literal id is wrong the moment the field renders inside a
     * list, because then there are several of it and the label points at the
     * first one.
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
   Sign-in: the refusal that had no way out
   ============================================================ */

describe('signing in with an address that was never confirmed', () => {
  it('offers to send the link again, where the refusal happened', async () => {
    /**
     * Somebody who signed up a week ago and lost the mail was told their address
     * is unconfirmed and left on a page offering "Forgot password" — which does
     * not help — and "Sign up", which answers that the address is already
     * registered. `POST /auth/verify-email/resend` existed the whole time; the
     * only page that could reach it was the one you arrive at by following the
     * link they no longer have.
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
   Sign-up: two fields that gated the button and would not say why
   ============================================================ */

describe('the sign-up form explains every field it blocks on', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, over: Record<string, string> = {}) {
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
  }

  it('says what is wrong with the address rather than only disabling the button', async () => {
    /**
     * Username, first name and last name each explained themselves inline. Email
     * and password — the other two the button gated on — said nothing at all, so
     * somebody who typed `nope` into the address field met a dead control with no
     * statement of why.
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
     * Sign-in had `loading={busy}` from the day it was written. Sign-up — the one
     * form in the product that creates an account — had no busy state at all, so
     * two presses were two registrations.
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
   The confirmation guarding an irreversible action
   ============================================================ */

describe('the confirmation modal', () => {
  it('keeps Tab inside itself', async () => {
    /**
     * Only the drawer had a focus trap. The modal — which guards donating a card
     * and cracking a slab — had none, so Tab from its last button moved focus
     * into the page behind, where Enter would act on whatever it landed on.
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
     * Cancel stayed live while the irreversible thing was already in flight, and
     * the confirm button was hand-rolled `<button className="btn">` — the only
     * two buttons in the product that opted out of the `Button` primitive, so the
     * control that most needed a spinner and `aria-busy` had neither.
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
     * Twenty-five of the thirty-six had none. `eventLabel` falls back to the raw
     * event type, so the feed badged them `wallet_request_completed`,
     * `escrow_funded`, `payment_reversed` — the database enum, in both languages.
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
     * Every service on a card is billed the instant the request is created, and
     * not one of the nine buttons in the drawer said so. "Donation" charged $20
     * to give a card away, and the confirmation for that irreversible act did not
     * mention money at all. The figures were never secret — they were in a price
     * table in the Help section, which is documentation rather than a decision.
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
   Buttons that mean different things should not look identical
   ============================================================ */

describe('visual weight', () => {
  it('gives the primitive one primary variant, not nine', () => {
    /**
     * Every service button in the card drawer was `gold`. Nine primary actions in
     * one list is the same as none: the eye has nothing to land on, and "donate
     * this card forever" carried the identical weight as "take a photo of it".
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
     * The sign-in card carried a text button that printed the name of the OTHER
     * language: "English" on the Hebrew page, and "עברית" on the English one — a
     * Hebrew word on the sign-in screen of an English build, which reads as a
     * stray label rather than as a way to change anything. It toggled between
     * exactly two languages, so it could never grow a third without lying.
     *
     * A language chooser is the one control that has to be recognisable to
     * somebody who cannot read the page it is on, which means an icon.
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
     * memorabilia, small collectibles and "other". The interface called all of
     * them cards, so somebody storing a graded comic read "No active cards" and
     * "We looked at the card and it matches the description" about their comic.
     */
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    // Strings that genuinely mean a card keep the word: the payment sense, the
    // two item classes that ARE cards, the name of a real kind of event, and the
    // Ship My Cards copy, which is quoted verbatim and must not be edited.
    const allowed = new Set([
      'money.route.card',
      'money.routeDesc.card',
      'wallet.request.funding.card',
      'itemClass.trading_card',
      'itemClass.oversized_card',
      'consign.channel.card_show',
      'faq.subtitle',
      'faq.sourceNote',
      'faq.quotedNotice',
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
     * The tab said "Cash in". The panel inside it said "Add money". The history
     * table said "Top up". Three names for one action on one screen, so nothing
     * on the page agreed with the tab that led to it.
     */
    const { MESSAGES } = await import('../../apps/web/src/shared/i18n');
    const en = MESSAGES.en as Record<string, string>;

    const strays = Object.entries(en)
      .filter(([, value]) => /\btop[- ]?up(s|ped)?\b|\badd (money|funds)\b/i.test(value))
      .map(([key]) => key);
    expect(strays).toEqual([]);

    // And the name that won is actually used.
    expect(en['wallet.tab.cash-in']).toBeTruthy();
    expect(en['money.topUp']).toBe('Cash in');
  });
});
