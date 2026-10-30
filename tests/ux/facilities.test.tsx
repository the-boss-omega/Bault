import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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
  ApiError: class ApiError extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The facilities, as the administrator keeps them: a roll of the places parcels are sent to and shipped from, and
 * in a drawer the address as a customer is given it, written as it is typed, over the fields that make it.
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
  const context = await browser!.newContext({
    viewport: { width, height: 1000 },
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

const facility = (id: string, extra: Record<string, unknown>) => ({
  id,
  code: 'XX',
  name: 'Facility',
  role: 'primary',
  line1: '500 Harbor Way',
  line2: null,
  city: 'Elizabeth',
  region: 'NJ',
  postalCode: '07201',
  country: 'US',
  phone: null,
  salesTaxBps: 663,
  forwardsToFacilityId: null,
  forwardsToCode: null,
  forwardingDays: null,
  active: true,
  placeholder: false,
  ...extra,
});

const PLACEHOLDER = 'SET REAL ADDRESS — placeholder';
const FACILITIES = () => [
  facility('f-nj', {
    code: 'NJ',
    name: 'Bault New Jersey',
    line1: PLACEHOLDER,
    city: 'Newark',
    postalCode: '00000',
    placeholder: true,
  }),
  facility('f-de', {
    code: 'DE',
    name: 'Bault Delaware',
    role: 'forwarding',
    line1: PLACEHOLDER,
    city: 'Wilmington',
    region: 'DE',
    postalCode: '00000',
    salesTaxBps: 0,
    forwardsToFacilityId: 'f-nj',
    forwardsToCode: 'NJ',
    forwardingDays: 4,
    placeholder: true,
  }),
  facility('f-or', {
    code: 'OR',
    name: 'Bault Oregon',
    line1: '12 Pier Road',
    line2: 'Dock 3',
    city: 'Portland',
    region: 'OR',
    postalCode: '97201',
    phone: '+1 503 555 0100',
    salesTaxBps: 0,
    active: false,
  }),
];

const COUNTRIES = [
  {
    code: 'US',
    name: 'United States',
    domestic: true,
    regionRequired: true,
    regions: [
      { code: 'DE', name: 'Delaware' },
      { code: 'NJ', name: 'New Jersey' },
      { code: 'OR', name: 'Oregon' },
    ],
  },
  { code: 'GB', name: 'United Kingdom', domestic: false, regionRequired: false },
];

let current: ReturnType<typeof FACILITIES>;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  current = FACILITIES();
  get.mockImplementation(async (path: string) => {
    if (path === '/admin/facilities') return current;
    if (path === '/shipping/countries') return COUNTRIES;
    return [];
  });
  window.location.hash = '#/admin/facilities';
});

function console_() {
  return render(
    <I18nProvider>
      <AdminConsole currentUserId="u2" />
    </I18nProvider>,
  );
}

async function roll() {
  const view = console_();
  await screen.findByRole('button', { name: 'Bault New Jersey' });
  return view;
}

const rows = () => Array.from(document.querySelectorAll('.data-table tbody tr')) as HTMLElement[];
const drawer = () => screen.getByRole('dialog');
const preview = () => drawer().querySelector('.address-block') as HTMLElement;
const lineOf = (label: string) =>
  within(drawer()).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('the facilities, a roll', () => {
  it('has a line to each facility: its name and code and where it is, what it does, and whether customers are shown it', async () => {
    await roll();
    expect(screen.getByRole('heading', { name: 'Facilities (3)' })).toBeInTheDocument();
    expect(rows()).toHaveLength(3);

    const [nj, de, or] = rows() as [HTMLElement, HTMLElement, HTMLElement];
    expect(nj).toHaveTextContent('Bault New Jersey');
    expect(nj).toHaveTextContent('NJ · Newark, NJ');
    expect(nj).toHaveTextContent('Primary');
    expect(within(nj).getByText('Active')).toBeInTheDocument();

    expect(de).toHaveTextContent('Forwarding');
    expect(de).toHaveTextContent('Forwards to NJ · 4 business days');

    expect(or).toHaveTextContent('Portland, OR');
    expect(within(or).getByText('Out of use')).toBeInTheDocument();
  });

  it('says which addresses are still the install’s stand-in, and only those', async () => {
    await roll();
    const [nj, de, or] = rows() as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(nj).getByText('Address not set')).toBeInTheDocument();
    expect(within(de).getByText('Address not set')).toBeInTheDocument();
    expect(within(or).queryByText('Address not set')).toBeNull();
  });

  it('keeps no field in its lines: a facility is changed in its drawer', async () => {
    await roll();
    expect(document.querySelectorAll('.data-table input, .data-table select')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers a first facility where there is none', async () => {
    current.length = 0;
    console_();
    expect(await screen.findByText('No facilities yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a facility' })).toBeInTheDocument();
  });
});

describe('a facility, opened', () => {
  it('opens by its name or anywhere in its line, on the address a customer is given', async () => {
    const user = userEvent.setup();
    await roll();

    await user.click(screen.getByRole('button', { name: 'Bault Oregon' }));

    expect(drawer()).toHaveAccessibleName('Bault Oregon');
    expect(window.location.hash).toBe('#/admin/facilities?facility=f-or');
    expect(preview().textContent).toBe(
      'Bault C/O username\n12 Pier Road\nDock 3\nPortland, OR 97201\nUS',
    );
    expect(preview()).toHaveAttribute('dir', 'ltr');
    expect(lineOf('Role')).toHaveTextContent('Primary');
    expect(lineOf('Sales tax (%)')).toHaveTextContent('0%');
    expect(within(drawer()).getByText('Out of use', { selector: '.pill' })).toBeInTheDocument();
    expect(
      within(drawer()).getByText(/not see it and cannot send new parcels/),
    ).toBeInTheDocument();
    // The code and the role are what parcels and shelves were written against: they are not fields.
    expect(within(drawer()).queryByRole('textbox', { name: 'Code' })).toBeNull();
    expect(within(drawer()).queryByRole('combobox', { name: 'Role' })).toBeNull();
    expect(within(drawer()).getByRole('textbox', { name: 'Phone (optional)' })).toHaveValue(
      '+1 503 555 0100',
    );
  });

  it('is a link that can be sent', async () => {
    window.location.hash = '#/admin/facilities?facility=f-de';
    console_();
    expect(await screen.findByRole('dialog', { name: 'Bault Delaware' })).toBeInTheDocument();
    expect(lineOf('Forwards to')).toHaveTextContent('NJ');
  });

  it('writes over a stand-in address: the street and the postcode begin empty, and nothing is saved until they are written', async () => {
    const user = userEvent.setup();
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault New Jersey' }));

    expect(within(drawer()).getByText(/still the install’s stand-in address/)).toBeInTheDocument();
    expect(within(drawer()).getByRole('textbox', { name: 'Street and number' })).toHaveValue('');
    expect(within(drawer()).getByRole('textbox', { name: 'Postal code' })).toHaveValue('');
    expect(preview().textContent).toBe('Bault C/O username\nNewark, NJ\nUS');
    expect(within(drawer()).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(
      within(drawer()).getByRole('textbox', { name: 'Street and number' }),
      '77 Real Street',
    );
    expect(within(drawer()).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(drawer()).getByRole('textbox', { name: 'Postal code' }), '07102');

    expect(preview().textContent).toBe('Bault C/O username\n77 Real Street\nNewark, NJ 07102\nUS');
    expect(within(drawer()).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('sends what the form now says, tells the drawer it was saved, and the stand-in badge goes', async () => {
    const user = userEvent.setup();
    patch.mockImplementation(async (_path: string, body: Record<string, unknown>) => {
      const saved = { ...current[0]!, ...body, placeholder: false };
      current[0] = saved as (typeof current)[number];
      return saved;
    });
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault New Jersey' }));
    await user.type(
      within(drawer()).getByRole('textbox', { name: 'Street and number' }),
      ' 77 Real Street ',
    );
    await user.type(within(drawer()).getByRole('textbox', { name: 'Postal code' }), '07102');
    await user.type(
      within(drawer()).getByRole('textbox', { name: 'Phone (optional)' }),
      '+1 973 555 0199',
    );
    await user.click(within(drawer()).getByRole('button', { name: 'Save' }));

    expect(patch).toHaveBeenCalledWith('/admin/facilities/f-nj', {
      name: 'Bault New Jersey',
      line1: '77 Real Street',
      line2: null,
      city: 'Newark',
      region: 'NJ',
      postalCode: '07102',
      country: 'US',
      phone: '+1 973 555 0199',
      salesTaxBps: 663,
    });
    expect(await within(drawer()).findByText('Bault New Jersey saved.')).toBeInTheDocument();
    expect(within(drawer()).queryByText(/still the install’s stand-in address/)).toBeNull();
    expect(within(rows()[0]!).queryByText('Address not set')).toBeNull();
    // Nothing is left to save.
    expect(within(drawer()).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('sends a forwarding facility’s two settings with it', async () => {
    const user = userEvent.setup();
    patch.mockImplementation(async (_p: string, body: Record<string, unknown>) => ({
      ...current[1]!,
      ...body,
    }));
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault Delaware' }));
    await user.type(
      within(drawer()).getByRole('textbox', { name: 'Street and number' }),
      '9 Relay Rd',
    );
    await user.type(within(drawer()).getByRole('textbox', { name: 'Postal code' }), '19801');
    const days = within(drawer()).getByRole('spinbutton', {
      name: 'Business days to the primary facility',
    });
    await user.clear(days);
    await user.type(days, '3');
    await user.click(within(drawer()).getByRole('button', { name: 'Save' }));

    expect(patch).toHaveBeenCalledWith(
      '/admin/facilities/f-de',
      expect.objectContaining({
        forwardsToFacilityId: 'f-nj',
        forwardingDays: 3,
        line1: '9 Relay Rd',
      }),
    );
  });

  it('keeps the form and says why where the server refuses', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(new Error('This country needs a state or region on its addresses.'));
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault Oregon' }));
    const city = within(drawer()).getByRole('textbox', { name: 'City' });
    await user.clear(city);
    await user.type(city, 'Salem');
    await user.click(within(drawer()).getByRole('button', { name: 'Save' }));

    expect(
      await within(drawer()).findByText('This country needs a state or region on its addresses.'),
    ).toBeInTheDocument();
    expect(city).toHaveValue('Salem');
    expect(within(drawer()).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('takes a facility out of use and puts it back, and tells the drawer which', async () => {
    const user = userEvent.setup();
    patch.mockImplementation(async (_p: string, body: Record<string, unknown>) => {
      const saved = { ...current[2]!, ...body };
      current[2] = saved as (typeof current)[number];
      return saved;
    });
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault Oregon' }));

    await user.click(within(drawer()).getByRole('button', { name: 'Put back in use' }));
    expect(patch).toHaveBeenLastCalledWith('/admin/facilities/f-or', { active: true });
    expect(await within(drawer()).findByText('Bault Oregon is back in use.')).toBeInTheDocument();
    expect(within(rows()[2]!).getByText('Active')).toBeInTheDocument();

    await user.click(within(drawer()).getByRole('button', { name: 'Take out of use' }));
    expect(patch).toHaveBeenLastCalledWith('/admin/facilities/f-or', { active: false });
    expect(await within(drawer()).findByText('Bault Oregon is out of use.')).toBeInTheDocument();
  });

  it('says why the server will not take the last way in out of use', async () => {
    const user = userEvent.setup();
    patch.mockRejectedValue(
      new Error(
        'This is the only active primary facility: customers would have nowhere to send a parcel.',
      ),
    );
    await roll();
    await user.click(screen.getByRole('button', { name: 'Bault New Jersey' }));
    await user.click(within(drawer()).getByRole('button', { name: 'Take out of use' }));

    expect(await within(drawer()).findByText(/only active primary facility/)).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('Active')).toBeInTheDocument();
  });
});

describe('a new facility', () => {
  const open = async () => {
    const user = userEvent.setup();
    await roll();
    await user.click(screen.getByRole('button', { name: 'Add a facility' }));
    await screen.findByRole('dialog', { name: 'New facility' });
    return user;
  };
  const field = (name: string) => within(drawer()).getByRole('textbox', { name });

  it('begins blank, in the country the product is run from, and cannot be added yet', async () => {
    await open();
    expect(window.location.hash).toBe('#/admin/facilities?facility=new');
    expect(preview().textContent).toBe('Bault C/O username\nUS');
    expect(field('Code')).toHaveValue('');
    expect(within(drawer()).getByRole('combobox', { name: 'Country' })).toHaveValue('US');
    expect(within(drawer()).getByRole('combobox', { name: 'Role' })).toHaveValue('primary');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('is written out as it is typed, with the code in capitals and the tax as a percentage', async () => {
    const user = await open();
    await user.type(field('Code'), 'nj2');
    await user.type(field('Name'), 'Bault Newark Annex');
    await user.type(field('Street and number'), '500 Harbor Way');
    await user.type(field('Suite, unit or dock (optional)'), 'Dock 4');
    await user.type(field('City'), 'Elizabeth');
    await user.selectOptions(
      within(drawer()).getByRole('combobox', { name: /State \/ province/ }),
      'NJ',
    );
    await user.type(field('Postal code'), '07201');
    const tax = field('Sales tax (%)');
    await user.clear(tax);
    await user.type(tax, '6.63');

    expect(field('Code')).toHaveValue('NJ2');
    expect(drawer().querySelector('.drawer-tag-title')).toHaveTextContent('Bault Newark Annex');
    expect(preview().textContent).toBe(
      'Bault C/O username\n500 Harbor Way\nDock 4\nElizabeth, NJ 07201\nUS',
    );
    expect(lineOf('Sales tax (%)')).toHaveTextContent('6.63%');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('adds what is written, closes, and says so on the page', async () => {
    const user = await open();
    post.mockImplementation(async (_p: string, body: Record<string, unknown>) =>
      facility('f-new', { ...body, placeholder: false }),
    );
    await user.type(field('Code'), 'nj2');
    await user.type(field('Name'), 'Bault Newark Annex');
    await user.type(field('Street and number'), '500 Harbor Way');
    await user.type(field('City'), 'Elizabeth');
    await user.selectOptions(
      within(drawer()).getByRole('combobox', { name: /State \/ province/ }),
      'NJ',
    );
    await user.type(field('Postal code'), '07201');
    const tax = field('Sales tax (%)');
    await user.clear(tax);
    await user.type(tax, '6.63');
    await user.click(within(drawer()).getByRole('button', { name: 'Add' }));

    expect(post).toHaveBeenCalledWith('/admin/facilities', {
      code: 'NJ2',
      role: 'primary',
      name: 'Bault Newark Annex',
      line1: '500 Harbor Way',
      line2: null,
      city: 'Elizabeth',
      region: 'NJ',
      postalCode: '07201',
      country: 'US',
      phone: null,
      salesTaxBps: 663,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Bault Newark Annex added.')).toBeInTheDocument();
    expect(rows()).toHaveLength(4);
    expect(window.location.hash).toBe('#/admin/facilities');
  });

  it('asks a forwarding facility where it forwards to, among the primary ones in use, and for how long', async () => {
    const user = await open();
    await user.selectOptions(
      within(drawer()).getByRole('combobox', { name: 'Role' }),
      'forwarding',
    );

    expect(
      within(drawer()).getByText('Receives parcels and passes them to a primary facility.'),
    ).toBeInTheDocument();
    const target = within(drawer()).getByRole('combobox', { name: 'Forwards to' });
    // Delaware forwards, and Oregon is out of use: only New Jersey can be forwarded to.
    expect(
      within(target)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose…', 'Bault New Jersey (NJ)']);

    await user.type(field('Code'), 'ny');
    await user.type(field('Name'), 'Bault New York');
    await user.type(field('Street and number'), '1 Relay Plaza');
    await user.type(field('City'), 'Albany');
    await user.selectOptions(
      within(drawer()).getByRole('combobox', { name: /State \/ province/ }),
      'NJ',
    );
    await user.type(field('Postal code'), '12207');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeDisabled();

    await user.selectOptions(target, 'f-nj');
    const days = within(drawer()).getByRole('spinbutton', {
      name: 'Business days to the primary facility',
    });
    fireEvent.change(days, { target: { value: '0' } });
    expect(
      await within(drawer()).findByText('Write a whole number from 1 to 60.'),
    ).toBeInTheDocument();
    expect(days).toHaveAttribute('aria-invalid', 'true');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(days, { target: { value: '3' } });
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(lineOf('Forwards to')).toHaveTextContent('NJ');
  });

  it('says what is wrong with a code and a tax rate as they are typed, and does not send them', async () => {
    const user = await open();
    await user.type(field('Code'), 'N');
    expect(
      await within(drawer()).findByText('Two to eight letters, digits or hyphens.'),
    ).toBeInTheDocument();
    expect(field('Code')).toHaveAttribute('aria-invalid', 'true');

    const tax = field('Sales tax (%)');
    await user.clear(tax);
    await user.type(tax, '6.255');
    expect(await within(drawer()).findByText(/percentage from 0 to 25/)).toBeInTheDocument();
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('asks for a state where the country has states to choose from, and takes a free line where it has not', async () => {
    const user = await open();
    expect(
      within(drawer()).getByRole('combobox', { name: /State \/ province/ }),
    ).toBeInTheDocument();

    await user.selectOptions(within(drawer()).getByRole('combobox', { name: 'Country' }), 'GB');
    expect(within(drawer()).queryByRole('combobox', { name: /State \/ province/ })).toBeNull();
    expect(field('State / province')).toHaveValue('');
    await user.type(field('Code'), 'LDN');
    await user.type(field('Name'), 'Bault London');
    await user.type(field('Street and number'), '1 Queen St');
    await user.type(field('City'), 'London');
    await user.type(field('Postal code'), 'EC1A 1BB');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeEnabled();
    expect(preview().textContent).toBe('Bault C/O username\n1 Queen St\nLondon, EC1A 1BB\nGB');
  });

  it('keeps what was written where the server refused it', async () => {
    const user = await open();
    post.mockRejectedValue(new Error('A facility with the code NJ2 already exists.'));
    await user.type(field('Code'), 'nj2');
    await user.type(field('Name'), 'Again');
    await user.type(field('Street and number'), '1 Same St');
    await user.type(field('City'), 'Elizabeth');
    await user.selectOptions(
      within(drawer()).getByRole('combobox', { name: /State \/ province/ }),
      'NJ',
    );
    await user.type(field('Postal code'), '07201');
    await user.click(within(drawer()).getByRole('button', { name: 'Add' }));

    expect(
      await within(drawer()).findByText('A facility with the code NJ2 already exists.'),
    ).toBeInTheDocument();
    expect(field('Name')).toHaveValue('Again');
    expect(within(drawer()).getByRole('button', { name: 'Add' })).toBeEnabled();
  });
});

describe('the facilities, in Hebrew', () => {
  it('are read in Hebrew, with the names and addresses in islands of their own', async () => {
    localStorage.setItem('bault.locale', 'he');
    const user = userEvent.setup();
    console_();
    await screen.findByRole('heading', { name: 'מתקנים (3)' });
    expect(screen.getByRole('button', { name: 'הוספת מתקן' })).toBeInTheDocument();
    expect(rows()[1]).toHaveTextContent('מעביר אל NJ · 4 ימי עסקים');

    await user.click(screen.getByRole('button', { name: 'Bault Oregon' }));
    expect(drawer().querySelector('.drawer-tag-title bdi')).toHaveAttribute('dir', 'auto');
    expect(drawer().querySelector('.address-block')).toHaveAttribute('dir', 'ltr');
    expect(within(drawer()).getByRole('button', { name: 'החזרה לשימוש' })).toBeInTheDocument();
  });
});

describe.skipIf(!browser)('the facilities, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`are read, reached and drawn without a flag: ${theme}, ${locale}, the roll and a drawer, desktop and phone`, async () => {
        localStorage.setItem('bault.locale', locale);
        const user = userEvent.setup();
        console_();
        await screen.findByRole('button', { name: 'Bault New Jersey' });

        for (const width of [1280, 390]) {
          const page = await inBrowser(width, locale, theme);
          expect(await audit.auditButtons(page)).toEqual([]);
          const flags = await audit.audit(page);
          expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
          await page.context().close();
        }

        await user.click(screen.getByRole('button', { name: 'Bault Delaware' }));
        await screen.findByRole('dialog');
        for (const width of [1280, 390]) {
          const page = await inBrowser(width, locale, theme);
          expect(await audit.auditButtons(page)).toEqual([]);
          const flags = await audit.audit(page);
          expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
          await page.context().close();
        }
      });
    }
  }
});
