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

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { HouseStoreSection } = await import('../../apps/web/src/areas/admin/HouseStoreSection');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  audit: (page: Page, options?: { forced?: boolean }) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
};

/**
 * The Bault store, as the manager keeps it: a product is written on a slip beside its fields as buyers will see
 * it, and each product in the store is that tag with what the store does with it under it. A number of copies is
 * changed and then saved; it is not saved by leaving the field.
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

interface Product {
  id: string;
  code: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  photoRef: string | null;
  askingPrice: number;
  stock: number;
  status: 'active' | 'removed';
}

const PRODUCTS: Product[] = [
  {
    id: 'p1',
    code: 'HSE-72WWGK10',
    typeClass: 'trading_card',
    description: '2011 Pokémon Call of Legends — Rayquaza #SL10/95',
    conditionGrade: 'PSA 9',
    photoRef: 'SN-CL10-0005',
    askingPrice: 18900,
    stock: 4,
    status: 'active',
  },
  {
    id: 'p2',
    code: 'HSE-72WWGK11',
    typeClass: 'trading_card',
    description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97',
    conditionGrade: null,
    photoRef: null,
    askingPrice: 25000,
    stock: 0,
    status: 'active',
  },
  {
    id: 'p3',
    code: 'HSE-72WWGK12',
    typeClass: 'trading_card',
    description: '2005 Pokémon EX Deoxys — Rayquaza ★ (Gold Star)',
    conditionGrade: 'NM',
    photoRef: null,
    askingPrice: 41000,
    stock: 2,
    status: 'removed',
  },
];

const onMsg = vi.fn();
const onError = vi.fn();
const wrap = () => (
  <I18nProvider>
    <HouseStoreSection onMsg={onMsg} onError={onError} />
  </I18nProvider>
);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  onMsg.mockReset();
  onError.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) =>
    path === '/marketplace/house/manage' ? PRODUCTS : [],
  );
  post.mockResolvedValue({});
  patch.mockResolvedValue({});
});

async function store() {
  const view = render(wrap());
  await screen.findByRole('heading', { name: /^Store products \(/ });
  await waitFor(() =>
    expect(document.querySelectorAll('.tag-grid > li').length).toBeGreaterThan(0),
  );
  return view;
}

const slip = () => document.querySelector('.request-slip .drawer-tag') as HTMLElement;
const lineOf = (tag: HTMLElement, label: string) =>
  within(tag).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;
const tagOf = (name: string | RegExp) => screen.getByRole('article', { name });
const stockField = (code: string) =>
  screen.getByRole('spinbutton', { name: `Copies in stock for ${code}` });
const saveFor = (code: string) =>
  within(stockField(code).closest('form')!).getByRole('button', { name: 'Save' });

describe('a product to be added, written on a slip as buyers will see it', () => {
  it('begins as a card with no photograph, no name and no price, which will go on sale as one copy', async () => {
    await store();
    expect(slip()).toHaveAccessibleName('Store product');
    expect(slip().querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent(
      'Description',
    );
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    // Its code is the store's to give, and is said not to be known yet.
    expect(lineOf(slip(), 'Code')).toHaveTextContent('Assigned when it is added');
    expect(lineOf(slip(), 'Condition')).toHaveTextContent('—');
    expect(lineOf(slip(), 'Type / class')).toHaveTextContent('Trading card');
    expect(lineOf(slip(), 'Copies in stock')).toHaveTextContent('1 in stock');
    expect(within(slip()).getByText('On sale')).toBeInTheDocument();
    expect(within(slip()).getByText('No photograph')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeDisabled();
  });

  it('follows what is typed: the name as it is written, the price, the condition and how many', async () => {
    const user = userEvent.setup();
    await store();
    await user.type(screen.getByRole('textbox', { name: 'Description' }), '2011 Pokémon Rayquaza');
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '189');
    await user.type(screen.getByRole('textbox', { name: 'Condition' }), 'PSA 9');
    const copies = screen.getByRole('spinbutton', { name: 'Copies in stock' });
    await user.clear(copies);
    await user.type(copies, '4');
    expect(slip().querySelector('.drawer-tag-title')).toHaveTextContent('2011 Pokémon Rayquaza');
    expect(slip().querySelector('.drawer-tag-title bdi')).toHaveAttribute('dir', 'auto');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('$189.00');
    expect(lineOf(slip(), 'Condition')).toHaveTextContent('PSA 9');
    expect(lineOf(slip(), 'Copies in stock')).toHaveTextContent('4 in stock');
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeEnabled();
  });

  it('is not ready on copies that are not a whole number, and says why', async () => {
    const user = userEvent.setup();
    await store();
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'A card');
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '10');
    const copies = screen.getByRole('spinbutton', { name: 'Copies in stock' });
    fireEvent.change(copies, { target: { value: '2.5' } });
    expect(await screen.findByText('A whole number of copies, one or more.')).toBeInTheDocument();
    expect(copies).toHaveAttribute('aria-invalid', 'true');
    expect(lineOf(slip(), 'Copies in stock')).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeDisabled();
    fireEvent.change(copies, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeDisabled();
    fireEvent.change(copies, { target: { value: '3' } });
    expect(screen.queryByText('A whole number of copies, one or more.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeEnabled();
  });

  it('looks for the photograph once the name has stopped changing, and not for each letter of it', async () => {
    const user = userEvent.setup();
    await store();
    const photo = screen.getByRole('textbox', { name: 'Catalogue photo' });
    await user.type(photo, 'SN-CL10-0005');
    // What was typed so far is not a name: nothing has been asked for, and the case is empty.
    expect(slip().querySelector('img')).toBeNull();
    expect(within(slip()).getByText('No photograph')).toBeInTheDocument();
    await waitFor(() => expect(slip().querySelector('img')).not.toBeNull(), { timeout: 3000 });
    expect(slip().querySelector('img')!.getAttribute('src')).toContain('SN-CL10-0005');
    // A name typed and then taken away asks for nothing once more.
    await user.clear(photo);
    await waitFor(() => expect(slip().querySelector('img')).toBeNull(), { timeout: 3000 });
  });

  it('adds what is written on the slip, and clears it for the next', async () => {
    const user = userEvent.setup();
    await store();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Type / class' }),
      'trading_card',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      '  2011 Pokémon Rayquaza ',
    );
    await user.type(screen.getByRole('textbox', { name: 'Condition' }), 'PSA 9');
    await user.type(screen.getByRole('textbox', { name: 'Catalogue photo' }), 'SN-CL10-0005');
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '189');
    const copies = screen.getByRole('spinbutton', { name: 'Copies in stock' });
    await user.clear(copies);
    await user.type(copies, '4');
    await user.click(screen.getByRole('button', { name: 'Add to store' }));
    expect(post).toHaveBeenCalledWith('/marketplace/house/listings', {
      typeClass: 'trading_card',
      description: '2011 Pokémon Rayquaza',
      conditionGrade: 'PSA 9',
      photoRef: 'SN-CL10-0005',
      askingPrice: 18900,
      stock: 4,
    });
    await waitFor(() => expect(onMsg).toHaveBeenCalledWith('Added to the store.'));
    // The slip is a blank one again, and the store was read once more.
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
    expect(slip().querySelector('.drawer-tag-amount')).toHaveTextContent('—');
    expect(get.mock.calls.filter(([p]) => p === '/marketplace/house/manage')).toHaveLength(2);
  });

  it('keeps what was written where the store refused it, and says why', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(new Error('A product with that description exists.'));
    await store();
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'A card');
    await user.type(screen.getByRole('textbox', { name: 'Price' }), '10');
    await user.click(screen.getByRole('button', { name: 'Add to store' }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('A product with that description exists.'),
    );
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('A card');
    expect(screen.getByRole('button', { name: 'Add to store' })).toBeEnabled();
  });
});

describe('the products in the store, a tag each', () => {
  it('are articles in a list, each named by its own name, and not forty regions or forty "Store product"s', async () => {
    await store();
    const tags = Array.from(document.querySelectorAll('.tag-grid .drawer-tag')) as HTMLElement[];
    expect(tags.map((t) => t.tagName)).toEqual(['ARTICLE', 'ARTICLE', 'ARTICLE']);
    expect(tags.map((t) => t.getAttribute('aria-label'))).toEqual(
      PRODUCTS.map((p) => p.description),
    );
    // The only region the page has is the slip a new product is written on.
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toContain(
      'Store product',
    );
    expect(tagOf(/Call of Legends/)).toBeInTheDocument();
  });

  it('are the tag buyers see: the card in its case, its name, its price, its code, its condition and what it is', async () => {
    await store();
    const tag = tagOf(/Call of Legends/);
    expect(tag.querySelector('.drawer-tag-title')).toHaveTextContent(
      '2011 Pokémon Call of Legends — Rayquaza #SL10/95',
    );
    expect(tag.querySelector('.drawer-tag-title bdi')).toHaveAttribute('dir', 'auto');
    expect(tag.querySelector('.drawer-tag-amount')).toHaveTextContent('$189.00');
    expect(lineOf(tag, 'Code')).toHaveTextContent('HSE-72WWGK10');
    expect(lineOf(tag, 'Condition')).toHaveTextContent('PSA 9');
    expect(lineOf(tag, 'Type / class')).toHaveTextContent('Trading card');
    // The card is a button that opens its photograph, as it is on every card of the product.
    expect(within(tag).getByRole('button', { name: /^Show photo of/ })).toBeInTheDocument();
    // A product with no condition says nothing of one.
    expect(lineOf(tagOf(/Dragon/), 'Condition')).toHaveTextContent('—');
  });

  it('say where each stands: on sale, sold out, or taken off sale, with what is left', async () => {
    await store();
    const standing = (name: RegExp) => {
      const foot = tagOf(name).querySelector('.drawer-tag-foot')!;
      return [
        foot.querySelector('.pill')?.textContent,
        foot.querySelector('.drawer-tag-note')?.textContent,
      ];
    };
    expect(standing(/Call of Legends/)).toEqual(['On sale', '4 in stock']);
    expect(standing(/Dragon/)).toEqual(['Sold out', '0 in stock']);
    expect(standing(/Deoxys/)).toEqual(['Removed', '2 in stock']);
  });

  it('change the copies only when told to save, not by leaving the field', async () => {
    const user = userEvent.setup();
    await store();
    const code = 'HSE-72WWGK10';
    expect(saveFor(code)).toBeDisabled();
    const field = stockField(code);
    await user.clear(field);
    await user.type(field, '6');
    expect(saveFor(code)).toBeEnabled();
    // Leaving the field is not saving it.
    await user.tab();
    await user.click(document.body);
    expect(patch).not.toHaveBeenCalled();
    await user.click(saveFor(code));
    expect(patch).toHaveBeenCalledWith('/marketplace/house/listings/p1', {
      stock: 6,
      expectedStock: 4,
    });
    await waitFor(() => expect(onMsg).toHaveBeenCalledWith('Saved.'));
  });

  it('save with Enter as well, and not what is the same or is not a number of copies', async () => {
    const user = userEvent.setup();
    await store();
    const code = 'HSE-72WWGK11';
    const field = stockField(code);
    // The same as it is: nothing to save. Not a count: nothing to save.
    expect(saveFor(code)).toBeDisabled();
    fireEvent.change(field, { target: { value: '-1' } });
    expect(saveFor(code)).toBeDisabled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(field, { target: { value: '1.5' } });
    expect(saveFor(code)).toBeDisabled();
    fireEvent.change(field, { target: { value: '' } });
    expect(saveFor(code)).toBeDisabled();
    await user.clear(field);
    await user.type(field, '9{Enter}');
    expect(patch).toHaveBeenCalledWith('/marketplace/house/listings/p2', {
      stock: 9,
      expectedStock: 0,
    });
  });

  it('take a product off sale, and put it back, and say so', async () => {
    const user = userEvent.setup();
    await store();
    await user.click(
      within(tagOf(/Call of Legends/).parentElement!).getByRole('button', {
        name: 'Take off sale',
      }),
    );
    expect(patch).toHaveBeenCalledWith('/marketplace/house/listings/p1', { status: 'removed' });
    await waitFor(() => expect(onMsg).toHaveBeenCalledWith('Saved.'));
    await user.click(
      within(tagOf(/Deoxys/).parentElement!).getByRole('button', { name: 'Put back on sale' }),
    );
    expect(patch).toHaveBeenCalledWith('/marketplace/house/listings/p3', { status: 'active' });
  });

  it('say that the stock was changed by someone else, and show what it now is, where the save was refused', async () => {
    const user = userEvent.setup();
    await store();
    patch.mockRejectedValue(new Error('The stock changed since you looked.'));
    const code = 'HSE-72WWGK10';
    await user.clear(stockField(code));
    await user.type(stockField(code), '9');
    get.mockImplementation(async (path: string) =>
      path === '/marketplace/house/manage'
        ? PRODUCTS.map((p) => (p.id === 'p1' ? { ...p, stock: 3 } : p))
        : [],
    );
    await user.click(saveFor(code));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('The stock changed since you looked.'),
    );
    // The tag reads what the store now has, in the field as well as on the tag.
    await waitFor(() => expect(stockField(code)).toHaveValue(3));
    expect(tagOf(/Call of Legends/).querySelector('.drawer-tag-note')).toHaveTextContent(
      '3 in stock',
    );
  });

  it('keeps what was typed where a save was refused and the stock is as it was', async () => {
    const user = userEvent.setup();
    await store();
    patch.mockRejectedValue(new Error('Could not save.'));
    const code = 'HSE-72WWGK10';
    await user.clear(stockField(code));
    await user.type(stockField(code), '9');
    await user.click(saveFor(code));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not save.'));
    expect(stockField(code)).toHaveValue(9);
    expect(saveFor(code)).toBeEnabled();
  });

  it('say that the store is empty, and have no tags, where it is', async () => {
    get.mockImplementation(async () => []);
    render(wrap());
    expect(await screen.findByText('The store is empty')).toBeInTheDocument();
    expect(document.querySelector('.tag-grid')).toBeNull();
  });

  it('are read in Hebrew with the name in an island of its own, so an English name keeps its order', async () => {
    localStorage.setItem('bault.locale', 'he');
    render(wrap());
    await screen.findByRole('heading', { name: /^מוצרים בחנות \(/ });
    await waitFor(() => expect(document.querySelectorAll('.tag-grid > li').length).toBe(3));
    const name = screen.getAllByText('2011 Pokémon Call of Legends — Rayquaza #SL10/95', {
      selector: 'bdi',
    })[0]!;
    expect(name).toHaveAttribute('dir', 'auto');
    expect(name.closest('.drawer-tag-title')).not.toBeNull();
    expect(document.querySelector('.request-slip .drawer-tag')).toHaveAccessibleName('מוצר בחנות');
  });
});

describe.skipIf(!browser)('the store, in a browser', () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const locale of ['en', 'he'] as const) {
      it(`is read, reached and drawn without a flag, on paper: ${theme}, ${locale}, desktop and phone`, async () => {
        localStorage.setItem('bault.locale', locale);
        render(wrap());
        await waitFor(() => expect(document.querySelectorAll('.tag-grid > li').length).toBe(3));
        for (const width of [1280, 390]) {
          const page = await inBrowser(width, locale, theme);
          const paper = await page.$$eval('.drawer-tag', (tags) =>
            tags.map((el) => {
              const style = getComputedStyle(el);
              return `${style.backgroundColor} ${style.color}`;
            }),
          );
          expect(new Set(paper)).toEqual(new Set(['rgb(243, 239, 230) rgb(21, 19, 15)']));
          expect(paper).toHaveLength(4);
          expect(await audit.auditButtons(page)).toEqual([]);
          const flags = await audit.audit(page);
          expect(flags.filter((f) => !/^enum names on screen/.test(f))).toEqual([]);
          await page.context().close();
        }
      });
    }
  }

  it('puts the slip beside the fields on a wide window and between the fields and the button on a phone', async () => {
    render(wrap());
    await waitFor(() => expect(document.querySelectorAll('.tag-grid > li').length).toBe(3));
    const box = (sel: string) =>
      `(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; })()`;
    const wide = await inBrowser(1280, 'en', 'dark');
    const w = {
      fields: (await wide.evaluate(box('.request-form-fields'))) as Record<string, number>,
      slip: (await wide.evaluate(box('.request-slip'))) as Record<string, number>,
      actions: (await wide.evaluate(box('.request-form-actions'))) as Record<string, number>,
    };
    expect(w.slip.left).toBeGreaterThanOrEqual(w.fields.right - 1);
    expect(w.actions.top).toBeGreaterThanOrEqual(w.fields.bottom - 1);
    await wide.context().close();

    const phone = await inBrowser(390, 'en', 'dark');
    const p = {
      fields: (await phone.evaluate(box('.request-form-fields'))) as Record<string, number>,
      slip: (await phone.evaluate(box('.request-slip'))) as Record<string, number>,
      actions: (await phone.evaluate(box('.request-form-actions'))) as Record<string, number>,
      sideways: (await phone.evaluate(
        'document.documentElement.scrollWidth - window.innerWidth',
      )) as number,
    };
    expect(p.slip.top).toBeGreaterThanOrEqual(p.fields.bottom - 1);
    expect(p.actions.top).toBeGreaterThanOrEqual(p.slip.bottom - 1);
    expect(p.sideways).toBeLessThanOrEqual(0);
    await phone.context().close();
  });

  it('gives a product three to a row where there is room, with its controls under it, and one to a phone', async () => {
    render(wrap());
    await waitFor(() => expect(document.querySelectorAll('.tag-grid > li').length).toBe(3));
    const tops = (page: Page) =>
      page.$$eval('.tag-grid > li', (items) =>
        items.map((li) => {
          const tag = li.querySelector('.drawer-tag')!.getBoundingClientRect();
          const form = li.querySelector('.product-controls')!.getBoundingClientRect();
          return {
            top: Math.round(tag.top),
            left: Math.round(tag.left),
            below: form.top >= tag.bottom - 1,
          };
        }),
      );
    const wide = await inBrowser(1280, 'en', 'dark');
    const row = await tops(wide);
    expect(new Set(row.map((r) => r.top)).size).toBe(1);
    expect(row.every((r) => r.below)).toBe(true);
    await wide.context().close();
    const phone = await inBrowser(390, 'en', 'dark');
    const column = await tops(phone);
    expect(new Set(column.map((r) => r.left)).size).toBe(1);
    expect(new Set(column.map((r) => r.top)).size).toBe(3);
    await phone.context().close();
  });
});
