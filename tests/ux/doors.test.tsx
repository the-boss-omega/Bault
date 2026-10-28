import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve([])),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { AuthShell } = await import('../../apps/web/src/areas/customer/auth/AuthPage');
const { SignInPage } = await import('../../apps/web/src/areas/customer/auth/SignInPage');
const { SignUpPage } = await import('../../apps/web/src/areas/customer/auth/SignUpPage');
const { ForgotPasswordPage } =
  await import('../../apps/web/src/areas/customer/auth/ForgotPasswordPage');
const { SecondFactorForm } =
  await import('../../apps/web/src/areas/customer/auth/SecondFactorForm');
const { ResetPasswordPage } =
  await import('../../apps/web/src/areas/customer/auth/ResetPasswordPage');
const { VerifyEmailPage } = await import('../../apps/web/src/areas/customer/auth/VerifyEmailPage');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The doors (sign in, sign up, the second factor's code, the link that was sent, a new password): each is a slip of
 * paper with a kicker, one button, and under a perforation what else one may do.
 */
const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const CSS = [
  'index',
  'theme',
  'slab',
  'components',
  'buttons',
  'landing',
  'app',
  'gallery',
  'screens',
  'motion',
]
  .map((name) => readFileSync(join(SRC, `${name}.css`), 'utf8'))
  .join('\n');
const BROWSER = '/opt/pw-browsers/chromium';

let browser: Browser | null = null;
try {
  browser = await chromium.launch(
    existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' },
  );
} catch {
  browser = null;
}
afterAll(async () => {
  await browser?.close();
});

type Locale = 'en' | 'he';

async function inBrowser(width: number, locale: Locale, theme: 'dark' | 'light'): Promise<Page> {
  const html = document.body.innerHTML;
  // The axe checks of the audit need a page that came from a context of its own.
  const context = await browser!.newContext({
    viewport: { width, height: 900 },
    reducedMotion: 'reduce',
    hasTouch: width < 800,
    isMobile: width < 800,
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bault</title><style>${CSS}</style></head><body>${html}</body></html>`,
  );
  return page;
}

const noop = () => {};

function door(which: 'signIn' | 'signUp' | 'forgot' | 'mfa' | 'reset' | 'verify') {
  switch (which) {
    case 'signIn':
      return <SignInPage onSignedIn={noop} onGoToSignUp={noop} onGoToForgotPassword={noop} />;
    case 'signUp':
      return <SignUpPage onGoToSignIn={noop} />;
    case 'forgot':
      return <ForgotPasswordPage onGoToSignIn={noop} />;
    case 'mfa':
      return <SecondFactorForm challengeToken="t" onSignedIn={noop} onRestart={noop} />;
    case 'reset':
      return <ResetPasswordPage />;
    case 'verify':
      return <VerifyEmailPage />;
  }
}

const renderDoor = (which: Parameters<typeof door>[0]) =>
  render(
    <I18nProvider>
      <AuthShell bare>{door(which)}</AuthShell>
    </I18nProvider>,
  );

beforeEach(() => {
  post.mockReset();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '#/';
});

describe('a door', () => {
  const KICKERS: [Parameters<typeof door>[0], string, string][] = [
    ['signIn', 'Members’ entrance', 'כניסת חברים'],
    ['signUp', 'New account', 'חשבון חדש'],
    ['forgot', 'Getting back in', 'שחזור גישה'],
    ['mfa', 'Second factor', 'אימות דו־שלבי'],
  ];

  for (const [which, en, he] of KICKERS) {
    it(`${which} says what the slip is over its heading, in both languages`, () => {
      const { container, unmount } = renderDoor(which);
      expect(container.querySelector('.auth-kicker')).toHaveTextContent(en);
      expect(container.querySelector('.auth-slip h2')).toBeInTheDocument();
      unmount();

      localStorage.setItem('bault.locale', 'he');
      const hebrew = renderDoor(which);
      expect(hebrew.container.querySelector('.auth-kicker')).toHaveTextContent(he);
    });
  }

  it('keeps the way somewhere else on the stub, under the button, and the form on the slip', async () => {
    const user = userEvent.setup();
    const { container } = renderDoor('signIn');
    const card = container.querySelector('form.auth-card')!;
    const slip = card.querySelector('.auth-slip') as HTMLElement;
    const stub = card.querySelector('.auth-stub') as HTMLElement;
    // The slip has the fields and the button that sends them; the stub has what else one may do.
    expect(within(slip).getByLabelText('Password')).toBeInTheDocument();
    expect(within(slip).getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
    expect(within(slip).queryByRole('button', { name: 'Sign up' })).toBeNull();
    expect(within(stub).getByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(within(stub).getByRole('button', { name: 'Sign up' })).toHaveClass('btn--link');
    // The slip comes first in the page and the stub after it, so that pressing Tab goes from the button to the links.
    expect(slip.compareDocumentPosition(stub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(within(slip).getByLabelText('Password'), 'x');
    expect(post).not.toHaveBeenCalled();
  });

  it('a page that has said what it came to is the same slip with its sentence on it, named by its heading', async () => {
    post.mockResolvedValueOnce({});
    const user = userEvent.setup();
    const { container } = renderDoor('forgot');
    await user.type(screen.getByRole('textbox'), 'red@bault.dev');
    await user.click(screen.getByRole('button', { name: /send/i }));
    const section = await screen.findByRole('region', { name: 'Reset your password' });
    expect(section).toHaveClass('auth-card');
    expect(container.querySelector('.auth-card .auth-kicker')).toHaveTextContent('Getting back in');
    expect(within(section).getByRole('status')).toHaveTextContent(/red@bault\.dev/);
  });
});

describe.skipIf(!browser)('a door, in a browser', () => {
  const WHICH = ['signIn', 'signUp', 'forgot', 'mfa'] as const;

  for (const theme of ['dark', 'light'] as const) {
    it(`is paper in the ${theme} theme, with the paper's controls on it, and its one button is the ink`, async () => {
      renderDoor('signIn');
      const page = await inBrowser(1100, 'en', theme);
      const read = (selector: string, prop: string) =>
        page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      expect(await read('.auth-card', 'background-color')).toBe('rgb(243, 239, 230)');
      expect(await read('.auth-card', 'color')).toBe('rgb(21, 19, 15)');
      // A field on paper is the lightest paper with the ink in it; its edge is the paper's line.
      expect(await read('#signin-password', 'background-color')).toBe('rgb(255, 253, 248)');
      expect(await read('#signin-password', 'color')).toBe('rgb(21, 19, 15)');
      // The one button is the print in either theme: the ink, with foil at its foot.
      expect(await read('.auth-card .btn--primary', 'background-color')).toBe('rgb(21, 19, 15)');
      expect(await read('.auth-card .btn--primary', 'background-image')).toContain(
        'linear-gradient',
      );
      // The foil is along the slip's top edge.
      expect(
        await page.$eval('.auth-card', (el) => getComputedStyle(el, '::before').backgroundImage),
      ).toContain('linear-gradient');
      await page.context().close();
    });
  }

  it('has its stub under the button, cut off by a perforation with a notch at each end', async () => {
    renderDoor('signIn');
    const page = await inBrowser(1100, 'en', 'dark');
    const box = (selector: string) =>
      page.$eval(selector, (el) => el.getBoundingClientRect().toJSON());
    const button = await box('.auth-card .btn--primary');
    const stub = await box('.auth-stub');
    const card = await box('.auth-card');
    expect(stub.top).toBeGreaterThan(button.bottom);
    // The stub is the width of the slip, to its edges; the notches are circles cut out of them.
    expect(stub.left).toBeCloseTo(card.left, 0);
    expect(stub.right).toBeCloseTo(card.right, 0);
    expect(await page.$eval('.auth-stub', (el) => getComputedStyle(el).borderTopStyle)).toBe(
      'dashed',
    );
    for (const end of ['::before', '::after']) {
      const notch = await page.$eval(
        '.auth-stub',
        (el, pseudo) => {
          const style = getComputedStyle(el, pseudo);
          return { width: style.width, height: style.height, radius: style.borderTopLeftRadius };
        },
        end,
      );
      expect(notch).toEqual({ width: '20px', height: '20px', radius: '50%' });
    }
    await page.context().close();
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      for (const which of WHICH) {
        it(`${which}: every control is read, edged and reached, on the paper: ${theme}, ${locale}`, async () => {
          localStorage.setItem('bault.locale', locale);
          renderDoor(which);
          const page = await inBrowser(390, locale, theme);
          expect(await audit.auditButtons(page)).toEqual([]);
          // What is printed on the paper is read on it: no contrast finding, in labels, hints, links or the code.
          const flags = await audit.audit(page);
          expect(flags.filter((flag) => /color-contrast/.test(flag))).toEqual([]);
          await page.context().close();
        });
      }
    }
  }

  it("shows a mistake in the paper's red, and a field that has one in a line of that red", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDoor('signUp');
    await user.type(screen.getByLabelText('Email'), 'nope');
    const page = await inBrowser(1100, 'en', 'dark');
    expect(
      await page.$eval('.auth-card .field-error', (el) => getComputedStyle(el).color),
    ).not.toBe('rgb(21, 19, 15)');
    expect(await page.$eval('#signup-email', (el) => getComputedStyle(el).borderTopColor)).toBe(
      await page.$eval('.auth-card .field-error', (el) => getComputedStyle(el).color),
    );
    expect(
      await audit.audit(page).then((flags) => flags.filter((f) => /color-contrast/.test(f))),
    ).toEqual([]);
    await page.context().close();
    unmount();
  });
});
