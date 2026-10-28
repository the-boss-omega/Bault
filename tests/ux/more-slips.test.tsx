import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { EscrowTab } = await import('../../apps/web/src/areas/customer/marketplace/EscrowTab');
const { SharedParcelsTab } =
  await import('../../apps/web/src/areas/customer/shipping/SharedParcelsTab');
const { FaqLegalPage } = await import('../../apps/web/src/areas/customer/help/FaqLegalPage');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * Three more forms that are slips: the escrow deal being opened (the deal as the other side will read it), the shared
 * parcel being opened or joined (and a parcel that exists, as a tag with a line for each collector), and the question
 * put to the assistant (a slip for what was asked and one, with foil, for what came back).
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

async function inBrowser(
  width: number,
  locale: Locale,
  theme: 'dark' | 'light',
  touch = false,
): Promise<Page> {
  const html = document.body.innerHTML;
  const context = await browser!.newContext({
    viewport: { width, height: 1000 },
    reducedMotion: 'reduce',
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bault</title><style>${CSS}</style></head><body>${html}</body></html>`,
  );
  return page;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '';
});

const slipOf = (container: HTMLElement) => container.querySelector('.request-slip') as HTMLElement;
const lineOf = (slip: HTMLElement, label: string) =>
  within(slip).getByText(label, { selector: 'dt' }).closest('.ledger-line') as HTMLElement;

describe('opening an escrow deal, as a slip', () => {
  beforeEach(() => {
    get.mockImplementation((path: string) => {
      if (path === '/escrow/mine') return Promise.resolve([]);
      if (path === '/escrow/terms')
        return Promise.resolve({ feeBps: 100, minimumFeeMinor: 2_500, minimumValueMinor: 50_000 });
      if (path === '/escrow/held') return Promise.resolve({ heldMinor: 0 });
      return Promise.resolve({});
    });
  });

  async function open() {
    const user = userEvent.setup();
    const view = render(
      <I18nProvider>
        <EscrowTab meId="u1" />
      </I18nProvider>,
    );
    await screen.findByLabelText('Their username');
    return { user, ...view };
  }

  it('is the price (a dash until it is typed) and each fact of the deal, a dash for what is not known yet', async () => {
    const { container, user } = await open();
    const slip = slipOf(container);
    expect(slip.querySelector('.drawer-tag-kicker')).toHaveTextContent('Agreed price');
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    expect(lineOf(slip, 'Other side')).toHaveTextContent('—');
    expect(lineOf(slip, 'What is being sold')).toHaveTextContent('—');
    expect(lineOf(slip, 'Fee')).toHaveTextContent('—');
    expect(within(lineOf(slip, 'Your side')).getByText('I am selling')).toBeInTheDocument();
    expect(
      within(lineOf(slip, 'At the end')).getByText('Straight into the buyer’s vault'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Agreed price', { selector: 'input' }), '1450');
    expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$1,450.00');
    // The fee is what the terms make of it: 1%, with a minimum.
    expect(within(lineOf(slip, 'Fee')).getByText('$25.00')).toBeInTheDocument();
    expect(slip).toHaveTextContent('The fee is charged to you when the deal settles.');
  });

  it('follows the side, who the other side is (an account by its username, or a person by name and address) and how it ends', async () => {
    const { container, user } = await open();
    const slip = slipOf(container);
    await user.selectOptions(screen.getByLabelText('Your side'), 'buyer');
    expect(within(lineOf(slip, 'Your side')).getByText('I am buying')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Their username'), 'golden');
    expect(within(lineOf(slip, 'Other side')).getByText('@golden')).toBeInTheDocument();

    await user.click(screen.getByLabelText('The other side has no Bault account'));
    expect(lineOf(slip, 'Other side')).toHaveTextContent('—');
    await user.type(screen.getByLabelText('Their name'), 'Dana Levi');
    await user.type(screen.getByLabelText('Their email'), 'dana@example.com');
    expect(lineOf(slip, 'Other side')).toHaveTextContent('Dana Levi (dana@example.com)');

    await user.selectOptions(
      screen.getByLabelText('What happens to the collectible at the end'),
      'ship_to_buyer',
    );
    expect(
      within(lineOf(slip, 'At the end')).getByText('Shipped to the buyer'),
    ).toBeInTheDocument();
  });

  it('opens the deal with what the slip says', async () => {
    post.mockResolvedValue({ code: 'ESC-1' });
    const { user } = await open();
    await user.type(screen.getByLabelText('Their username'), 'golden');
    await user.type(screen.getByLabelText('What is being sold'), 'A Rayquaza ex, PSA 9');
    await user.type(screen.getByLabelText('Agreed price', { selector: 'input' }), '1450');
    await user.click(screen.getByRole('button', { name: 'Open the deal' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: 'golden',
        counterpartyName: undefined,
        counterpartyEmail: undefined,
        description: 'A Rayquaza ex, PSA 9',
        valueMinor: 145_000,
        settlement: 'buyer_vault',
      }),
    );
  });
});

describe('a shared parcel, opened, joined and kept', () => {
  const REQUESTS = [
    {
      id: 's1',
      code: 'SHP-AAAA1111',
      status: 'requested',
      groupId: null,
      destinationAddress: 'Dana Levi, 12 Vine St, Trenton, NJ 08608, US',
    },
    {
      id: 's2',
      code: 'SHP-BBBB2222',
      status: 'requested',
      groupId: null,
      destinationAddress: 'Dana Levi, 12 Vine St, Trenton, NJ 08608, US',
    },
  ];
  const GROUP = {
    id: 'g1',
    code: 'GRP-7P6YKNHS',
    status: 'forming',
    destinationAddress: 'Dana Levi, 12 Vine St, Trenton, NJ 08608, US',
    recipientName: 'Dana Levi',
    notes: 'Table 14, the blue badge',
    memberCount: 2,
    totalItems: 2,
    totalWeightGrams: 10,
    members: [
      {
        shipmentId: 's9',
        shipmentCode: 'SHP-QYCSKRAX',
        username: 'red',
        name: 'Red Ashwood',
        itemCount: 1,
        weightGrams: 5,
        isPayer: true,
        insuredValueMinor: 0,
        status: 'requested',
      },
      {
        shipmentId: 's10',
        shipmentCode: 'SHP-4ZFYRWGF',
        username: 'golden',
        name: 'Golden Marsh',
        itemCount: 1,
        weightGrams: 5,
        isPayer: false,
        insuredValueMinor: 0,
        status: 'requested',
      },
    ],
  };

  async function open(groups: unknown[] = [GROUP]) {
    get.mockImplementation((path: string) => {
      if (path === '/shipping/groups') return Promise.resolve(groups);
      if (path === '/shipping/shipments') return Promise.resolve(REQUESTS);
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    const view = render(
      <I18nProvider>
        <SharedParcelsTab
          reloadToken={0}
          onChanged={vi.fn()}
          onError={vi.fn()}
          onStatus={vi.fn()}
        />
      </I18nProvider>,
    );
    await screen.findByText('GRP-7P6YKNHS');
    return { user, ...view };
  }

  it('opens as a slip that says where it goes once a request is chosen, who pays, and where it will stand', async () => {
    const { user } = await open();
    const slip = document.querySelectorAll('.request-slip')[0] as HTMLElement;
    expect(slip.querySelector('.drawer-tag-kicker')).toHaveTextContent('Open a shared parcel');
    expect(slip.querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();
    expect(lineOf(slip, 'Which request')).toHaveTextContent('—');
    expect(within(lineOf(slip, 'Payer')).getByText('You')).toBeInTheDocument();
    expect(within(slip).getByText('Forming')).toBeInTheDocument();

    const select = screen.getAllByLabelText('Which request')[0]!;
    await user.selectOptions(select, 's1');
    expect(slip.querySelector('.drawer-tag-title')).toHaveTextContent(
      'Dana Levi, 12 Vine St, Trenton, NJ 08608, US',
    );
    expect(within(lineOf(slip, 'Which request')).getByText('SHP-AAAA1111')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Notes'), 'Table 14');
    expect(within(lineOf(slip, 'Notes')).getByText('Table 14')).toBeInTheDocument();
    expect(slip).toHaveTextContent(
      'Whoever opens it is the payer, and only they can lock or cancel it.',
    );
  });

  it('opens the parcel with the request and the notes the slip names', async () => {
    post.mockResolvedValue({});
    const { user } = await open();
    await user.selectOptions(screen.getAllByLabelText('Which request')[0]!, 's1');
    await user.type(screen.getByLabelText('Notes'), 'Table 14');
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/shipping/groups', {
        shipmentId: 's1',
        notes: 'Table 14',
      }),
    );
  });

  it('joins as a slip that names the parcel as its code is typed, and the request and the address it would bring', async () => {
    const { user } = await open();
    const slip = document.querySelectorAll('.request-slip')[1] as HTMLElement;
    expect(slip.querySelector('.drawer-tag-kicker')).toHaveTextContent('Join an existing parcel');
    expect(slip.querySelector('.drawer-tag-title')).toHaveTextContent('GRP-XXXXXXXX');
    expect(slip.querySelector('.drawer-tag-title .drawer-tag-quiet')).not.toBeNull();

    await user.type(screen.getByLabelText('Parcel code'), 'GRP-7P6YKNHS');
    expect(slip.querySelector('.drawer-tag-title .drawer-tag-quiet')).toBeNull();
    expect(slip.querySelector('.drawer-tag-title')).toHaveTextContent('GRP-7P6YKNHS');
    await user.selectOptions(screen.getAllByLabelText('Which request')[1]!, 's2');
    expect(within(lineOf(slip, 'Goes to')).getByText(/12 Vine St/)).toBeInTheDocument();
  });

  it('keeps a parcel as a tag in a list: its number, who it is for and where it goes, and each collector in it with where theirs stands', async () => {
    await open();
    const tag = screen.getByRole('article', { name: 'GRP-7P6YKNHS' });
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent('Dana Levi');
    expect(within(lineOf(tag, 'Goes to')).getByText(/12 Vine St/)).toBeInTheDocument();
    expect(within(lineOf(tag, 'Notes')).getByText('Table 14, the blue badge')).toBeInTheDocument();
    const members = within(tag).getAllByRole('listitem');
    expect(members).toHaveLength(2);
    expect(members[0]).toHaveTextContent('Red Ashwood');
    expect(within(members[0]!).getByText('Payer')).toBeInTheDocument();
    expect(members[1]).toHaveTextContent('Golden Marsh');
    expect(members[1]).toHaveTextContent('SHP-4ZFYRWGF');
    expect(within(tag).getByText('2 collectors · 2 items · 10 g')).toBeInTheDocument();
    // Its two ways on are under it, not on it.
    expect(within(tag).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close to new members' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel the parcel' })).toHaveClass('btn--danger');
  });
});

describe('the question put to the assistant', () => {
  async function open() {
    window.location.hash = '#/faq/ask';
    const user = userEvent.setup();
    const view = render(
      <I18nProvider>
        <FaqLegalPage />
      </I18nProvider>,
    );
    await screen.findByLabelText('Your question');
    return { user, ...view };
  }

  it('is written on a slip that says, under it, what an answer is worth, and the question is not sent empty', async () => {
    const { user } = await open();
    const input = screen.getByLabelText('Your question');
    expect(input).toHaveAccessibleDescription(
      'The automated legal assistant is not currently connected. Every question returns a placeholder response.',
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Nothing asked yet')).toBeInTheDocument();
  });

  it('puts what was asked on a slip and what came back on another, in the log a screen reader is told of', async () => {
    const { user } = await open();
    await user.type(screen.getByLabelText('Your question'), 'How long does grading take?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const log = screen.getByRole('log', { name: 'Conversation' });
    await waitFor(() => expect(within(log).getByText('#1DDD')).toBeInTheDocument());
    const [asked, answered] = Array.from(log.querySelectorAll('.ask-slip'));
    expect(asked).toHaveClass('ask-slip--you');
    expect(asked).toHaveTextContent('How long does grading take?');
    expect(answered).toHaveClass('ask-slip--bot');
    expect(answered).toHaveTextContent('Assistant');
    // The question box is empty again, and the question itself is not lost with it.
    expect(screen.getByLabelText('Your question')).toHaveValue('');
  });
});

describe.skipIf(!browser)('the three, in a browser', () => {
  it('draws the composer as paper in both themes, its field the paper’s, its one button the print', async () => {
    window.location.hash = '#/faq/ask';
    render(
      <I18nProvider>
        <FaqLegalPage />
      </I18nProvider>,
    );
    // A button with nothing to send is a blank; with a question in the box it is the print.
    await userEvent.type(await screen.findByLabelText('Your question'), 'Is grading insured?');
    for (const theme of ['dark', 'light'] as const) {
      const page = await inBrowser(1100, 'en', theme);
      const read = (selector: string, prop: string) =>
        page.$eval(selector, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      expect(await read('.ask-composer', 'background-color')).toBe('rgb(243, 239, 230)');
      expect(await read('#ask-question', 'background-color')).toBe('rgb(255, 253, 248)');
      expect(await read('.ask-composer .btn--primary', 'background-color')).toBe('rgb(21, 19, 15)');
      expect(await audit.auditButtons(page)).toEqual([]);
      await page.context().close();
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`reads the answer printed on its slip (a code is a pill elsewhere, ink on paper here): ${theme}, ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/faq/ask';
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <FaqLegalPage />
          </I18nProvider>,
        );
        await user.type(await screen.findByRole('textbox'), 'שאלה');
        await user.keyboard('{Enter}');
        await screen.findByText('#1DDD');
        const page = await inBrowser(390, locale, theme, true);
        const code = await page.$eval('code.ask-words', (el) => {
          const style = getComputedStyle(el);
          return { bg: style.backgroundColor, color: style.color, border: style.borderTopWidth };
        });
        expect(code.bg).toBe('rgba(0, 0, 0, 0)');
        expect(code.color).toBe('rgb(21, 19, 15)');
        expect(code.border).toBe('0px');
        const flags = await audit.audit(page);
        expect(flags.filter((f) => /color-contrast/.test(f))).toEqual([]);
        expect(await audit.auditButtons(page)).toEqual([]);
        await page.context().close();
      });
    }
  }

  it('puts the escrow slip beside its fields on a wide window, between the fields and the button on a phone', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/escrow/mine') return Promise.resolve([]);
      if (path === '/escrow/terms')
        return Promise.resolve({ feeBps: 100, minimumFeeMinor: 2_500, minimumValueMinor: 50_000 });
      if (path === '/escrow/held') return Promise.resolve({ heldMinor: 0 });
      return Promise.resolve({});
    });
    render(
      <I18nProvider>
        <EscrowTab meId="u1" />
      </I18nProvider>,
    );
    await screen.findByLabelText('Their username');
    for (const width of [1440, 390]) {
      const page = await inBrowser(width, 'en', 'dark', width < 800);
      const box = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const form = document.querySelector('.request-form')!;
        const fields = rect('.request-form .request-form-fields');
        const slip = rect('.request-form .request-slip');
        const actions = rect('.request-form .request-form-actions');
        void form;
        return {
          beside: slip.left >= fields.right - 1 || slip.right <= fields.left + 1,
          between: slip.top >= fields.bottom - 1 && actions.top >= slip.bottom - 1,
        };
      });
      if (width >= 1100) expect(box.beside).toBe(true);
      else expect(box.between).toBe(true);
      await page.context().close();
    }
  });
});
