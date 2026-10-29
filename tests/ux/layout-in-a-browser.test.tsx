import { describe, it, expect, vi, afterAll } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

// The first page a browser gives is slow on a busy runner, and the files that use one run side by side, each with its own: five seconds is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider, useT } = await import('../../apps/web/src/shared/i18n');
const { DetailDrawer } = await import('../../apps/web/src/shared/ui/DetailDrawer');
const { CardPhotoThumb } = await import('../../apps/web/src/shared/CardPhoto');
const { PageHeader, NotificationBell, LanguageSwitcher, MobileBar } = await import('../../apps/web/src/shared/ui/PageHeader');
const { NavigationRail } = await import('../../apps/web/src/shared/ui/NavigationRail');
const { ContextTabs, DetailRow } = await import('../../apps/web/src/shared/ui/primitives');
const { StatementSlip } = await import('../../apps/web/src/areas/customer/finance/StatementSlip');
const { AccountingSection } = await import('../../apps/web/src/areas/admin/AccountingSection');
const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { WalletRequestForm } = await import('../../apps/web/src/areas/customer/finance/WalletRequestForms');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');
const { SignInsSection } = await import('../../apps/web/src/areas/admin/SignInsSection');
const { SellPanel } = await import('../../apps/web/src/areas/customer/marketplace/MarketplacePage');
const { ProposeTradePanel } = await import('../../apps/web/src/areas/customer/marketplace/ProposeTradePanel');
const { RegisterParcelForm } = await import('../../apps/web/src/areas/customer/inbound/InboundPage');
const { SupportPage } = await import('../../apps/web/src/areas/customer/support/SupportPage');
const { FaqLegalPage } = await import('../../apps/web/src/areas/customer/help/FaqLegalPage');
const { ProfilePage } = await import('../../apps/web/src/areas/customer/profile/ProfilePage');
const { api } = await import('../../apps/web/src/shared/api');
const { billableActions, coverage } =
  await import('../../apps/api/src/modules/prc/billable-actions');
const { MEMBERSHIP_TIERS } = await import('../../apps/api/src/modules/mem/tiers');
const { revealField } = await import('../../apps/web/src/shared/ui/revealField');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  auditFocus: (page: Page, stops?: number) => Promise<string[]>;
  auditButtons: (page: Page) => Promise<string[]>;
  inspect: (page: Page, locale: string, width: number) => Promise<{ flags: string[]; title: string }>;
};

/**
 * What the tests above cannot say, because jsdom lays nothing out: whether an overlay covers the window, a
 * menu can be clicked, a closed sheet is out of the way of the keyboard, a focus ring is cut off. The real
 * markup of the real components is rendered here, taken out of jsdom as the HTML it is, and put in a
 * browser with the real stylesheets. No server, no data, no bundle: what is measured is the markup and the
 * CSS, which is where each of these was wrong.
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
  browser = await chromium.launch(existsSync(BROWSER) ? { executablePath: BROWSER } : { channel: 'chrome' });
} catch {
  browser = null;
}

afterAll(async () => {
  await browser?.close();
});

type Locale = 'en' | 'he';

/** The document jsdom has now, in a browser: the stylesheets, the page's language and theme, a window of this size. */
async function inBrowser(width: number, locale: Locale = 'en', theme: 'dark' | 'light' = 'dark', shell = true): Promise<Page> {
  const html = document.body.innerHTML;
  const page = await browser!.newPage({ viewport: { width, height: width < 800 ? 844 : 900 }, reducedMotion: 'no-preference' });
  await page.setContent(
    `<!doctype html><html lang="${locale}" dir="${locale === 'he' ? 'rtl' : 'ltr'}" data-theme="${theme}"><head><meta charset="utf-8"><style>${CSS}</style></head>` +
      `<body>${shell ? `<div class="app-shell"><div class="workspace"><div class="workspace-inner">${html}</div></div></div>` : html}</body></html>`,
  );
  // Whatever enters has finished entering: it is measured where it stays.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 4000 }).catch(() => {});
  return page;
}

const window$ = (page: Page) => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

/** What is on top at the middle of a box: is it the box (or something in it)? */
const reachable = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(window.innerWidth - 2, Math.max(2, box.left + box.width / 2)),
      Math.min(window.innerHeight - 2, Math.max(2, box.top + Math.min(box.height, window.innerHeight) / 2)),
    );
    return !!top && (el.contains(top) || top.contains(el));
  }, selector);

describe.skipIf(!browser)('the layout, in a browser', () => {
  describe('an overlay', () => {
    it('a drawer covers the window, and once it has arrived it is nothing anything fixed is trapped in', async () => {
      render(
        <I18nProvider>
          <DetailDrawer title="SN-CL10-0005" subtitle="2011 Pokémon Call of Legends" onClose={() => {}}>
            <p>Body</p>
            <div id="fixed-inside" style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} />
          </DetailDrawer>
        </I18nProvider>,
      );
      for (const width of [1440, 390]) {
        const page = await inBrowser(width, 'en', 'dark', false);
        const { w, h } = await window$(page);

        const backdrop = await page.$eval('.drawer-backdrop', (el) => el.getBoundingClientRect().toJSON());
        expect(backdrop).toMatchObject({ left: 0, top: 0, width: w, height: h });

        const drawer = await page.$eval('.drawer', (el) => ({ box: el.getBoundingClientRect().toJSON(), transform: getComputedStyle(el).transform }));
        // In the window, and against its edge: a side panel the whole height of a desktop, a sheet from the bottom of a phone.
        expect(drawer.box.top).toBeGreaterThanOrEqual(-1);
        expect(drawer.box.left).toBeGreaterThanOrEqual(-1);
        expect(drawer.box.right).toBeLessThanOrEqual(w + 1);
        expect(drawer.box.bottom).toBeGreaterThanOrEqual(h - 1);
        expect(drawer.box.bottom).toBeLessThanOrEqual(h + 1);
        if (width >= 800) expect(drawer.box.height).toBeGreaterThanOrEqual(h - 1);
        // A transform left on it by an animation that is over would make it the box that fixed things are fixed in.
        expect(drawer.transform).toBe('none');
        expect(await page.$eval('#fixed-inside', (el) => el.getBoundingClientRect().toJSON())).toMatchObject({ width: w, height: h });
        expect(await reachable(page, '.drawer')).toBe(true);
        await page.close();
      }
    });

    it('a drawer keeps its close button the size it is, however long what it is about is named', async () => {
      render(
        <I18nProvider>
          <DetailDrawer
            title="SN-CL10-0005"
            subtitle="2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo (Shiny Legendary subset) · art by Noriko Hotta · col1-SL10"
            onClose={() => {}}
          >
            <p>Body</p>
          </DetailDrawer>
        </I18nProvider>,
      );
      for (const width of [1440, 390]) {
        const page = await inBrowser(width, 'en', 'dark', false);
        const close = await page.$eval('.drawer-head .icon-btn', (el) => el.getBoundingClientRect().toJSON());
        // WCAG 2.2, 2.5.8: a target is at least 24 by 24 CSS pixels (this one is a control, 40).
        expect(close.width).toBeGreaterThanOrEqual(40);
        expect(close.height).toBeGreaterThanOrEqual(40);
        await page.close();
      }
    });

    it('a drawer that scrolls keeps a control that is half in view, and its ring, off the edge it is scrolled to', async () => {
      render(
        <I18nProvider>
          <DetailDrawer title="SN-CL10-0005" subtitle="2011 Pokémon Call of Legends" onClose={() => {}}>
            <p>Body</p>
            <div id="spacer" />
            <button type="button" className="btn">
              Consignment sale $20.00
            </button>
            <div style={{ height: 600 }} />
          </DetailDrawer>
        </I18nProvider>,
      );
      for (const width of [1440, 390]) {
        const page = await inBrowser(width, 'en', 'dark', false);
        // The button is half below the fold, as one is when the content above it is as tall as it happens to be.
        await page.evaluate(() => {
          const body = document.querySelector('.drawer-body') as HTMLElement;
          const button = body.querySelector('button.btn') as HTMLElement;
          const spacer = document.getElementById('spacer') as HTMLElement;
          const target = body.getBoundingClientRect().bottom - button.getBoundingClientRect().height / 2;
          spacer.style.height = `${Math.max(0, target - button.getBoundingClientRect().top)}px`;
        });
        // Tab to it, as a keyboard does: the browser scrolls the edge of the button to the edge of the body.
        const cut = (await audit.auditFocus(page, 4)).filter((flag) => /cut off/.test(flag));
        expect(cut).toEqual([]);
        await page.close();
      }
    });

    it('the photograph is a room that covers the window, with the card, its plate and its close button in it', async () => {
      const user = userEvent.setup();
      render(
        <I18nProvider>
          <div style={{ transform: 'translateY(-8px)' }}>
            <CardPhotoThumb serialNumber="SN-DX107-0003" title="2005 Pokémon EX Deoxys — Rayquaza" />
          </div>
        </I18nProvider>,
      );
      await user.click(screen.getByRole('button', { name: /Show photo of/ }));

      for (const width of [1440, 390]) {
        const page = await inBrowser(width, 'en', 'dark', false);
        const { w, h } = await window$(page);
        expect(await page.$eval('.lightbox', (el) => el.getBoundingClientRect().toJSON())).toMatchObject({ left: 0, top: 0, width: w, height: h });
        for (const part of ['.lightbox-close', '.lightbox .modal-slab']) {
          const box = await page.$eval(part, (el) => el.getBoundingClientRect().toJSON());
          expect(box.width, `${part} has a size`).toBeGreaterThan(20);
          expect(box.left, `${part} starts inside the window`).toBeGreaterThanOrEqual(-1);
          expect(box.top, `${part} starts inside the window`).toBeGreaterThanOrEqual(-1);
          expect(box.right, `${part} ends inside the window`).toBeLessThanOrEqual(w + 1);
          expect(box.bottom, `${part} ends inside the window`).toBeLessThanOrEqual(h + 1);
          expect(await reachable(page, part), `${part} can be reached`).toBe(true);
        }
        await page.close();
      }
    });
  });

  describe('a menu in the header', () => {
    const items = [
      { id: 'n1', eventType: 'item_received', content: { barcode: 'SN-CL10-0005', message: 'Item SN-CL10-0005 was received.' }, channel: 'in_app', status: 'sent', createdAt: '2026-10-27T10:00:00Z' },
      { id: 'n2', eventType: 'wallet_request_completed', content: { message: 'Your cash-in was approved.' }, channel: 'in_app', status: 'sent', createdAt: '2026-10-26T10:00:00Z' },
    ] as never;

    function Header() {
      return (
        <I18nProvider>
          <PageHeader
            title="My vault"
            crumbs={[{ label: 'Home' }, { label: 'Vault' }]}
            actions={
              <span className="ph-controls">
                <LanguageSwitcher />
                <NotificationBell items={items} unseen={2} onOpen={() => {}} onViewAll={() => {}} renderTitle={() => 'Item received'} renderText={() => 'SN-CL10-0005 is in your vault.'} />
              </span>
            }
          />
        </I18nProvider>
      );
    }

    for (const which of ['bell', 'language'] as const) {
      for (const [locale, width] of [['en', 1440], ['he', 1440], ['en', 390], ['he', 390]] as const) {
        it(`the ${which} menu opens, is on screen and can be clicked: ${locale}, ${width}px`, async () => {
          const user = userEvent.setup();
          localStorage.setItem('bault.locale', locale);
          render(<Header />);
          const trigger = document.querySelector<HTMLElement>(which === 'bell' ? 'button[aria-haspopup="dialog"]' : 'button[aria-haspopup="menu"]')!;
          await user.click(trigger);

          const page = await inBrowser(width, locale);
          const { w } = await window$(page);
          const box = await page.$eval('.pop', (el) => el.getBoundingClientRect().toJSON());
          expect(box.width).toBeGreaterThan(100);
          expect(box.left).toBeGreaterThanOrEqual(-1);
          expect(box.right).toBeLessThanOrEqual(w + 1);
          expect(box.top).toBeGreaterThanOrEqual(-1);
          // What is at the middle of the menu is the menu: nothing is drawn over it and nothing clips it away.
          expect(
            await page.evaluate(() => {
              const el = document.querySelector('.pop')!;
              const rect = el.getBoundingClientRect();
              const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 60));
              return !!top && el.contains(top);
            }),
          ).toBe(true);
          await page.close();
        });
      }
    }
  });

  describe('the rail on a phone', () => {
    const destinations = [
      { key: 'vault', label: 'Vault', icon: <svg width="20" height="20" /> },
      { key: 'wallet', label: 'Wallet', icon: <svg width="20" height="20" /> },
      { key: 'support', label: 'Support', icon: <svg width="20" height="20" />, secondary: true },
    ];
    const phone = (open: boolean) => (
      <I18nProvider>
        <NavigationRail destinations={destinations} active="wallet" onNavigate={() => {}} mobile open={open} onRequestClose={() => {}} />
      </I18nProvider>
    );

    it('is out of the keyboard’s way while it is closed', async () => {
      render(phone(false));
      const page = await inBrowser(390, 'en', 'dark', false);
      await page.waitForTimeout(500);
      expect(await page.$eval('.rail', (el) => getComputedStyle(el).visibility)).toBe('hidden');
      const reachableItems = await page.$$eval('.rail button, .rail a', (els) => els.filter((el) => el.checkVisibility({ visibilityProperty: true })).length);
      expect(reachableItems).toBe(0);
      await page.close();
    });

    it('is there once open, with its icons a column wide and its labels beside them', async () => {
      render(phone(true));
      const page = await inBrowser(390, 'en', 'dark', false);
      expect(await page.$eval('.rail', (el) => getComputedStyle(el).visibility)).toBe('visible');
      const icon = await page.$eval('.rail-icon', (el) => el.getBoundingClientRect().width);
      expect(icon).toBeGreaterThan(40);
      const [iconBox, labelBox] = await page.$eval('.rail-item', (el) => [el.querySelector('.rail-icon')!, el.querySelector('.rail-label')!].map((n) => n.getBoundingClientRect().toJSON()));
      // The label starts where the icon ends: it is not drawn over it.
      expect(labelBox.left).toBeGreaterThanOrEqual(iconBox.right - 1);
      await page.close();
    });
  });

  describe('the bar across the top of a phone', () => {
    for (const theme of ['dark', 'light'] as const) {
      it(`its menu button can be seen against the bar, which is the colour of the page in either theme: ${theme}`, async () => {
        render(
          <I18nProvider>
            <MobileBar title="My vault" onOpenMenu={() => {}} />
          </I18nProvider>,
        );
        const page = await inBrowser(390, 'en', theme, false);
        // The audit's own question of every icon button: its glyph against what it stands on (3:1).
        expect(await audit.auditButtons(page)).toEqual([]);
        // It was a glyph made white in the markup, for a bar that was dark, and was gone on the light one.
        const [glyph, bar] = await page.$eval('.mobile-bar', (el) => [
          getComputedStyle(el.querySelector('.icon-btn')!).color,
          getComputedStyle(el).backgroundColor,
        ]);
        expect(glyph).not.toBe('rgb(255, 255, 255)');
        expect(glyph).not.toBe(bar);
        await page.close();
      });
    }
  });

  describe('a strip of tabs', () => {
    const tabs = Array.from({ length: 9 }, (_, i) => ({ key: `t${i}`, label: `Section number ${i}` }));

    it('does not cut off the ring of the tab that has focus, whichever end of the strip it is at', async () => {
      for (const active of ['t0', 't8']) {
        cleanup();
        render(<ContextTabs label="sections" tabs={tabs} active={active} onSelect={() => {}} />);
        for (const [locale, width] of [['en', 390], ['he', 390], ['en', 1440]] as const) {
          const page = await inBrowser(width, locale);
          // The strip has been scrolled to where the tab is: the end of it, for the last.
          await page.evaluate(() => {
            const strip = document.querySelector('.ctx-tabs')!;
            const selected = document.querySelector('[aria-selected="true"]')!;
            // As far as the strip goes, for the last tab; the start of it for the first.
            const rtl = getComputedStyle(strip).direction === 'rtl';
            const far = selected.matches(':last-child') ? strip.scrollWidth : 0;
            strip.scrollLeft = rtl ? -far : far;
          });
          const flags = await audit.auditFocus(page, 4);
          expect(flags.filter((f) => /cut off/.test(f)), `${active}, ${locale} ${width}`).toEqual([]);
          await page.close();
        }
      }
    });
  });

  describe('the contents of a legal document', () => {
    for (const locale of ['en', 'he'] as const) {
      it(`say each number once and read it first, as the headings are written, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/faq/legal';
        // The figures the page quotes, as the server gives them (a page without them is not the page).
        vi.mocked(api.get).mockImplementation(((path: string) =>
          Promise.resolve(
            path === '/content/account-terms'
              ? {
                  termsVersion: '2026-10-draft-1',
                  debt: { graceDays: 14, interestBpsPerDay: 5, suspendBelowMinor: -2000 },
                  cashOut: { bandMinor: 10_000, smallBps: 600, smallMinimumMinor: 99, largeFixedMinor: 500, largeBps: 100 },
                  chargebackFeeMinor: 2_500,
                  escrow: { feeBps: 100, minimumFeeMinor: 2_500, minimumValueMinor: 50_000 },
                  shipping: {
                    restockingFeeMinor: 2_500,
                    paymentWindowDays: 7,
                    insurancePremiumBps: 150,
                    insuranceMinimumPremiumMinor: 200,
                    maxInsuredValueMinor: 500_000,
                    signatureRequiredAboveMinor: 50_000,
                  },
                  removeCommonsWindowDays: 30,
                }
              : [],
          )) as never);
        render(
          <I18nProvider>
            <FaqLegalPage />
          </I18nProvider>,
        );
        await screen.findByText(/14 days|14 ימים/);
        await waitFor(() => expect(document.querySelector('.legal-toc a')).not.toBeNull());
        const page = await inBrowser(1440, locale);
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll('.legal-toc li')].map((li) => {
            const text = li.querySelector('a')!.firstChild as Text;
            const at = (i: number) => {
              const range = document.createRange();
              range.setStart(text, i);
              range.setEnd(text, i + 1);
              return range.getBoundingClientRect().left;
            };
            return {
              text: text.data.slice(0, 14),
              marker: getComputedStyle(li).listStyleType,
              number: at(0),
              word: at(text.data.search(/[A-Za-z]/)),
            };
          }),
        );
        expect(rows.length).toBeGreaterThan(5);
        for (const row of rows) {
          // The heading begins with its number: a marker of the list's own would say it twice, and in a
          // right-to-left line the number is drawn after the words ("About these terms .1").
          expect(row.marker, row.text).toBe('none');
          expect(row.number, row.text).toBeLessThan(row.word);
        }
        await page.close();
      });
    }
  });

  describe('the rows of a drawer', () => {
    for (const locale of ['en', 'he'] as const) {
      it(`keep inside it on a phone, a date wrapping at its space where the column is narrower than it: ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        render(
          <I18nProvider>
            <DetailDrawer title="Transaction details" onClose={() => {}}>
              <dl className="detail-list">
                <DetailRow label="Type">Service charge</DetailRow>
                <DetailRow label="Date">
                  <span className="date">
                    {locale === 'he' ? '28 באוקטובר 2026 בשעה 13:00' : 'October 28, 2026 at 1:00 PM'}
                  </span>
                </DetailRow>
                <DetailRow label="Record ID">
                  <code dir="ltr">1e7a2e35-1fbd-4871-b4c9-17b5fc69d9ef</code>
                </DetailRow>
              </dl>
            </DetailDrawer>
          </I18nProvider>,
        );
        const page = await inBrowser(390, locale);
        const body = await page.$eval('.drawer-body', (el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }));
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        await page.close();
      });
    }
  });

  describe('the guides', () => {
    for (const locale of ['en', 'he'] as const) {
      it(`are English, read from the left, with the full stop of a sentence at its end, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/faq/guides?g=first-week';
        render(
          <I18nProvider>
            <FaqLegalPage />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelector('.timeline li p')).not.toBeNull());
        const page = await inBrowser(1440, locale);
        // A guide is written in English only. On a Hebrew page a paragraph of it that nothing says is English reads
        // from the right, and the full stop that ends each sentence is drawn at the start of the line.
        const marked = await page.$$eval('.timeline li p', (ps) =>
          ps.map((p) => `${p.getAttribute('lang')} ${p.getAttribute('dir')}`),
        );
        expect(marked.length).toBeGreaterThan(3);
        expect(new Set(marked)).toEqual(new Set(['en ltr']));
        const { flags } = await audit.inspect(page, locale, 1440);
        expect(flags.filter((f) => /wrong way round|out of order/.test(f))).toEqual([]);
        await page.close();
      });

      it(`show what is related with a chevron the size of a letter, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/faq/guides?g=first-week';
        render(
          <I18nProvider>
            <FaqLegalPage />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelector('.check-list li svg')).not.toBeNull());
        const page = await inBrowser(1440, locale);
        // An icon is given its size by where it stands; the chevron of a related guide had none, and was as large
        // as the page was wide.
        const icons = await page.$$eval('.check-list li svg', (els) =>
          els.map((el) => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
        );
        expect(icons.length).toBeGreaterThan(0);
        expect(Math.max(...icons)).toBeLessThanOrEqual(24);
        await page.close();
      });

      it(`name each guide in English where they are listed, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/faq/guides';
        render(
          <I18nProvider>
            <FaqLegalPage />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelector('.card-grid .card-title')).not.toBeNull());
        const page = await inBrowser(1440, locale);
        const names = await page.$$eval('.card-grid li', (cards) =>
          cards.flatMap((card) =>
            [...card.querySelectorAll('.card-title span, .card-desc span, .card-hit span')].map(
              (el) => `${el.getAttribute('lang')} ${el.getAttribute('dir')}`,
            ),
          ),
        );
        expect(names.length).toBeGreaterThan(9);
        expect(new Set(names)).toEqual(new Set(['en ltr']));
        await page.close();
      });
    }
  });

  describe('a ring measured on the way', () => {
    it('is measured once what has focus has come to rest: a box that scrolls it into view smoothly is not caught half way', async () => {
      render(
        <div
          id="box"
          style={{
            height: 120,
            padding: 8,
            overflowY: 'auto',
            scrollBehavior: 'smooth',
            scrollPaddingBlock: 12,
          }}
        >
          <div style={{ height: 600 }} />
          <textarea aria-label="Description" rows={2} />
        </div>,
      );
      const page = await inBrowser(390);
      // As the drawer does when a field takes focus (revealField), and as the browser does of its own accord.
      await page.evaluate(() => {
        document.querySelector('textarea')!.addEventListener('focus', (event) => {
          (event.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      });
      const flags = await audit.auditFocus(page, 2);
      expect(flags.filter((flag) => /cut off/.test(flag))).toEqual([]);
      await page.close();
    });
  });

  describe('a strip of tabs that is wider than a phone', () => {
    // The admin console has eleven of them. A tab keeps the width of its word and the strip scrolls: a tab that is
    // given a minimum width of its own may shrink below its word, and the words are then drawn on one another.
    const tabs = [
      'Shelf yield',
      'Users',
      'Sign-ins',
      'Parked messages',
      'Wallet requests',
      'Accounting',
      'Items',
      'Bault store',
      'Pricing',
      'Disputes',
      'Storage fees',
    ].map((label, i) => ({ key: `t${i}`, label }));

    for (const [locale, width] of [
      ['en', 390],
      ['he', 390],
      ['en', 320],
    ] as const) {
      it(`keeps each tab as wide as its word, and one after the other: ${locale}, ${width}px`, async () => {
        localStorage.setItem('bault.locale', locale);
        render(<ContextTabs label="sections" tabs={tabs} active="t0" onSelect={() => {}} />);
        const page = await inBrowser(width, locale);
        const boxes = await page.$$eval('.ctx-tab', (els) =>
          els.map((el) => {
            const box = el.getBoundingClientRect();
            return { word: el.textContent, left: box.left, right: box.right, fits: el.scrollWidth <= el.clientWidth + 0.5 };
          }),
        );
        expect(boxes).toHaveLength(tabs.length);
        for (const box of boxes) expect(box.fits, `${box.word} is as wide as its word`).toBe(true);
        // Each tab starts where the one before it ended (the strip is read from the right in Hebrew).
        for (let i = 1; i < boxes.length; i += 1) {
          const [before, after] = [boxes[i - 1]!, boxes[i]!];
          const apart = locale === 'he' ? before.left - after.right : after.left - before.right;
          expect(apart, `${before.word} and ${after.word} do not overlap`).toBeGreaterThanOrEqual(-0.5);
        }
        await page.close();
      });
    }
  });

  describe('the wallet statement on a phone', () => {
    function Slip() {
      const t = useT();
      return <StatementSlip amount={970000} flows={{ inflow: 1000000, outflow: 30000, count: 8 }} expanded t={t} />;
    }

    for (const locale of ['en', 'he'] as const) {
      it(`still shows credited, less debited, is the balance, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        render(
          <I18nProvider>
            <Slip />
          </I18nProvider>,
        );
        const page = await inBrowser(390, locale, 'dark', false);
        for (const [selector, sign] of [['.statement-term--minus', '−'], ['.statement-term--equals', '=']] as const) {
          const operator = await page.$eval(selector, (el) => {
            const style = getComputedStyle(el, '::before');
            return { content: style.content, position: style.position };
          });
          // `content: '−' / ''`: the sign, with no spoken alternative.
          expect(operator.content.split(' / ')[0].replace(/["']/g, '')).toBe(sign);
          expect(operator.position).toBe('absolute');
        }
        // And nothing in it is wider than the phone.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
        await page.close();
      });
    }
  });
  describe('the month’s statement', () => {
    // Figures as wide as a marketplace's can get: the widest a figure will be is no excuse for one that is cut off.
    const summary = {
      month: '2026-10',
      currency: 'USD',
      byType: [],
      revenue: {
        totalMinor: 1_234_567_890,
        lines: [
          { key: 'service_charge', totalMinor: 1_200_000_000 },
          { key: 'commission', totalMinor: 34_567_890 },
          { key: 'cash_out_fee', totalMinor: 0 },
        ],
        refundsMinor: 2_000,
        cashOutFeesReturnedMinor: 99,
        carrierCostOnShippingChargesMinor: 5_000,
      },
      customerMoney: { inMinor: 9_876_543_210, outMinor: 100_000, payoutsReturnedMinor: 1_500, reversedMinor: 0, netMinor: 9_876_443_210 },
      balancesHeld: {
        asOf: '2026-10-27T15:30:00.000Z',
        customerTotalMinor: 8_765_432_100,
        owedToCustomersMinor: 8_765_432_100,
        owedByCustomersMinor: 0,
        accountsWithBalance: 3,
        platformAccountMinor: 0,
      },
      note: '',
    };

    for (const locale of ['en', 'he'] as const) {
      it(`has the revenue beside what is held for customers on a wide sheet and one under another on a phone, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        vi.mocked(api.get).mockResolvedValueOnce(summary);
        const user = userEvent.setup();
        render(
          <I18nProvider>
            <AccountingSection onError={() => {}} />
          </I18nProvider>,
        );
        await user.click(screen.getByRole('button', { name: locale === 'he' ? 'הצגת הסיכום' : /show summary/i }));
        await waitFor(() => expect(document.querySelector('.ledger-sheet')).not.toBeNull());

        for (const width of [1440, 900, 390]) {
          const page = await inBrowser(width, locale);
          const sheet = await page.$eval('.ledger-sheet', (el) => el.getBoundingClientRect().toJSON());
          const [revenue, moneyIn, held] = await page.$$eval('.ledger-col', (els) => els.map((el) => el.getBoundingClientRect().toJSON()));

          // Every block is inside the sheet.
          for (const box of [revenue, moneyIn, held]) {
            expect(box.left).toBeGreaterThanOrEqual(sheet.left - 1);
            expect(box.right).toBeLessThanOrEqual(sheet.right + 1);
          }
          if (width >= 900) {
            // The revenue stands on the side the page begins on, the other two are one above the other on the other side.
            if (locale === 'en') expect(revenue.right).toBeLessThanOrEqual(moneyIn.left + 1);
            else expect(revenue.left).toBeGreaterThanOrEqual(moneyIn.right - 1);
            expect(Math.abs(moneyIn.left - held.left)).toBeLessThan(2);
            expect(held.top).toBeGreaterThanOrEqual(moneyIn.bottom - 1);
          } else {
            // One under another, each the width of the sheet.
            expect(moneyIn.top).toBeGreaterThanOrEqual(revenue.bottom - 1);
            expect(held.top).toBeGreaterThanOrEqual(moneyIn.bottom - 1);
            expect(Math.abs(revenue.width - sheet.width)).toBeLessThan(2);
          }

          // No figure runs out of its block, and a phone has nothing wider than itself.
          const cut = await page.$$eval('.ledger-figure, .ledger-line', (els) =>
            els
              .filter((el) => {
                const box = el.getBoundingClientRect();
                const inner = el.querySelector('.amount, dd')?.getBoundingClientRect() ?? box;
                return inner.right > box.right + 1 || inner.left < box.left - 1;
              })
              .map((el) => el.textContent),
          );
          expect(cut).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        }
      });
    }
  });
  describe('a table in a management panel', () => {
    const user = (id: string, username: string, mfaEnabled: boolean) => ({
      id,
      email: `${username}@bault.dev`,
      username,
      firstName: username[0]!.toUpperCase() + username.slice(1),
      lastName: 'Cohen',
      nameReviewRequired: false,
      role: 'collector',
      status: 'active',
      autoSuspended: false,
      intakeId: null,
      mfaEnabled,
    });

    const item = (id: string) => ({
      id,
      serialNumber: `SN-${id}`,
      barcode: `BLT-${id}`,
      typeClass: 'trading_card',
      description: `2021 Evolving Skies Rayquaza VMAX ${id}`,
      conditionGrade: null,
      lifecycleState: 'stored',
      holdFlag: false,
      binId: null,
      ownerId: 'u1',
      ownerEmail: 'eldar@bault.dev',
    });

    // The accounts and the items are each a roll of links. Each has controls at the edge of a table that scrolls.
    for (const tab of ['users', 'items'] as const) {
    for (const locale of ['en', 'he'] as const) {
      for (const width of [1440, 390]) {
        it(`shows a control whole with its ring wherever the ${tab} table has scrolled to, ${locale}, ${width}px`, async () => {
          localStorage.setItem('bault.locale', locale);
          window.location.hash = `#/admin/${tab}`;
          vi.mocked(api.get).mockImplementation(async (path: string) =>
            path === '/admin/users'
              ? [user('u1', 'eldar', true), user('u2', 'hermon', true), user('u3', 'red', false)]
              : path === '/admin/items'
                ? [item('i1'), item('i2')]
                : [],
          );
          render(
            <I18nProvider>
              <AdminConsole currentUserId="me" />
            </I18nProvider>,
          );
          if (tab === 'users') await screen.findByRole('button', { name: 'Eldar Cohen' });
          else await screen.findByRole('button', { name: '2021 Evolving Skies Rayquaza VMAX i1' });
          const page = await inBrowser(width, locale);
          // What the page does when a control takes focus (the scrollable-regions hook asks for it to be shown
          // whole), and then: is its ring, which is drawn outside it, in the table's room?
          const cut = await page.evaluate(() => {
            const out: string[] = [];
            for (const wrap of document.querySelectorAll<HTMLElement>('.dt-wrap')) {
              for (const el of wrap.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')) {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                const box = el.getBoundingClientRect();
                const room = wrap.getBoundingClientRect();
                const left = room.left + wrap.clientLeft;
                const right = left + wrap.clientWidth;
                // The ring is two pixels wide at a two-pixel offset.
                if (box.left - 4 < left - 0.5 || box.right + 4 > right + 0.5) out.push(el.getAttribute('aria-label') ?? el.textContent ?? el.tagName);
              }
            }
            return out;
          });
          expect(cut).toEqual([]);
          await page.close();
        });
      }
    }
    }
  });
  describe('the rate card', () => {
    const RULE = (id: string, actionType: string, description: string) => ({
      id,
      actionType,
      itemClass: null,
      description,
      model: 'fixed',
      value: 1500,
      currency: 'USD',
      billingTrigger: 'per_event',
      effectiveFrom: '2026-10-27T12:00:00.000Z',
    });
    const RULES = [
      RULE('r1', 'service_fee:condition_inspection', 'Per-area condition report against a fixed severity scale'),
      RULE('r2', 'consignment_fee:auction_house', 'Commission on an auction-house consignment sale'),
      RULE('r3', 'shipping_addon:gps_tracker', 'A tracker placed in the parcel'),
    ];

    for (const locale of ['en', 'he'] as const) {
      it(`breaks the name of an action that has none of its own where it is made of parts, never inside a word, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        window.location.hash = '#/admin/pricing';
        vi.mocked(api.get).mockImplementation(((path: string) =>
          Promise.resolve(
            path === '/pricing/rules'
              ? RULES
              : path === '/admin/pricing/coverage'
                ? JSON.parse(JSON.stringify(coverage(billableActions(), [])))
                : path === '/membership/tiers'
                  ? {
                      tiers: MEMBERSHIP_TIERS.map((t) => ({ ...t, priceMinor: t.listPriceMinor })),
                      uncovered: [],
                      cycleDays: 30,
                      currency: 'USD',
                    }
                  : [],
          )) as never);
        render(
          <I18nProvider>
            <AdminConsole currentUserId="me" />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelector('.rate-group-title .code-inline')).not.toBeNull());
        for (const width of [1440, 390]) {
          const page = await inBrowser(width, locale);
          const broken = await page.evaluate(() => {
            const out: string[] = [];
            for (const code of document.querySelectorAll('.rate-group-title .code-inline')) {
              const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const range = document.createRange();
                range.selectNodeContents(node);
                // A word that is drawn on two lines is drawn in two boxes, one to a line.
                if (range.getClientRects().length > 1) out.push(node.textContent ?? '');
              }
            }
            return out;
          });
          expect(broken, `${locale} ${width}px`).toEqual([]);
          await page.close();
        }
      });
    }
  });
  describe('an account or an item, opened in a drawer', () => {
    const account = (id: string, username: string, more: Record<string, unknown> = {}) => ({
      id,
      email: `${username}@bault.dev`,
      username,
      firstName: username[0]!.toUpperCase() + username.slice(1),
      lastName: 'Cohen',
      nameReviewRequired: false,
      role: 'user',
      status: 'active',
      autoSuspended: false,
      intakeId: null,
      mfaEnabled: true,
      ...more,
    });
    const card = {
      id: 'i1',
      serialNumber: 'SN-ROS105-0008',
      barcode: 'SN-ROS105-0008',
      typeClass: 'trading_card',
      description: '2015 Pokémon XY Roaring Skies — M Rayquaza-EX (Full Art, Δ Evolution) #105/108',
      conditionGrade: 'Raw',
      lifecycleState: 'stored',
      holdFlag: true,
      binId: null,
      ownerId: 'u1',
      ownerEmail: 'eldar@bault.dev',
    };

    // A drawer scrolls. Whichever control takes the keyboard in it, it is shown with its ring: the ring is drawn
    // outside the control, and what the drawer scrolls it to is the edge of its body.
    for (const record of ['user', 'item'] as const) {
      for (const locale of ['en', 'he'] as const) {
        for (const width of [1440, 390]) {
          it(`keeps the ring of every control in the ${record} drawer inside it, ${locale}, ${width}px`, async () => {
            localStorage.setItem('bault.locale', locale);
            window.location.hash = record === 'user' ? '#/admin/users?user=u1' : '#/admin/items?item=i1';
            vi.mocked(api.get).mockImplementation(async (path: string) =>
              path === '/admin/users'
                ? [account('u1', 'eldar', { autoSuspended: true, status: 'suspended' }), account('u2', 'hermon')]
                : path === '/admin/items'
                  ? [card]
                  : [],
            );
            render(
              <I18nProvider>
                <AdminConsole currentUserId="me" />
              </I18nProvider>,
            );
            await waitFor(() => expect(document.querySelector('.drawer')).not.toBeNull());
            const page = await inBrowser(width, locale, 'dark', false);
            // What the app does when a field takes focus in a dialog (the page's script is not here, but its function is).
            await page.evaluate(
              `(() => { const reveal = ${revealField.toString()}; const panel = document.querySelector('.drawer'); panel.addEventListener('focusin', (e) => reveal(e.target, panel, 'auto')); })()`,
            );
            const cut = (await audit.auditFocus(page, 40)).filter((flag) => /cut off/.test(flag));
            expect(cut).toEqual([]);
            await page.close();
          });
        }
      }
    }
  });
  describe('registers, case files and labels, where what was typed is long and the page reads right to left', () => {
    const ticket = (id: string, subject: string, at: string) => ({
      id,
      code: `TKT-${id}`,
      subject,
      status: 'open',
      category: 'parcel',
      relatedType: null,
      relatedId: null,
      lastMessageAt: at,
      createdAt: at,
    });
    const profile = {
      id: 'u1',
      email: 'red@bault.dev',
      username: 'red',
      role: 'user',
      status: 'active',
      firstName: 'Red',
      lastName: 'Ashwood',
      fullName: 'Red Ashwood',
      nameReviewRequired: false,
    };

    for (const locale of ['en', 'he'] as const) {
      for (const width of [1440, 390]) {
        it(`hangs the time of an entry from the edge the page starts at, ${locale}, ${width}px`, async () => {
          localStorage.setItem('bault.locale', locale);
          window.location.hash = '#/support';
          vi.mocked(api.get).mockImplementation(async (path: string) =>
            path === '/support/tickets'
              ? [ticket('A1', 'Where is my parcel', '2026-10-27T09:08:00.000Z')]
              : [],
          );
          render(
            <I18nProvider>
              <SupportPage />
            </I18nProvider>,
          );
          await screen.findByRole('button', { name: 'Where is my parcel' });
          const page = await inBrowser(width, locale);
          // A time has no letters to say which way it reads: its digits must start at the edge of its box that
          // the page starts at (the left in English, the right in Hebrew), not at the left in both.
          const { box, text } = await page.evaluate(() => {
            const el = document.querySelector('.timeline--stamped > li > .date') as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(el);
            const b = el.getBoundingClientRect();
            const t = range.getBoundingClientRect();
            return { box: { left: b.left, right: b.right }, text: { left: t.left, right: t.right } };
          });
          if (locale === 'en') expect(text.left - box.left).toBeLessThan(2);
          else expect(box.right - text.right).toBeLessThan(2);
          await page.close();
        });
      }
    }

    it('keeps a case file the size of its neighbours however long its ruling is', async () => {
      localStorage.setItem('bault.locale', 'en');
      window.location.hash = '#/admin/disputes';
      const long =
        'The buyer is to be refunded in full, and the seller is to be reminded of the condition grades. '.repeat(8);
      vi.mocked(api.get).mockImplementation(async (path: string) =>
        path === '/admin/disputes'
          ? [
              {
                id: '41ea85e9-0000-4000-8000-000000000001',
                transactionId: 'c5013f0a-0000-4000-8000-000000000001',
                status: 'ruled',
                ruling: long,
                note: null,
                createdAt: '2026-10-27T13:00:00.000Z',
              },
            ]
          : [],
      );
      render(
        <I18nProvider>
          <AdminConsole currentUserId="me" />
        </I18nProvider>,
      );
      await waitFor(() => expect(document.querySelector('.tag-item .drawer-tag-title')).not.toBeNull());
      for (const width of [1440, 390]) {
        const page = await inBrowser(width, 'en');
        const { height, line } = await page.evaluate(() => {
          const el = document.querySelector('.tag-item .drawer-tag-title') as HTMLElement;
          return { height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) };
        });
        // Three lines, and no more: the rest is under the file, in the field that is changed.
        expect(height).toBeLessThanOrEqual(line * 3 + 1);
        expect(height).toBeGreaterThan(line * 2);
        await page.close();
      }
    });

    const address = (id: string, label: string) => ({
      id,
      label,
      recipient: 'Red Ashwood',
      line1: '1200 Market St',
      city: 'San Francisco',
      region: 'CA',
      country: 'US',
      postalCode: '94102',
      isDefault: id === 'a1',
    });
    for (const locale of ['en', 'he'] as const) {
      for (const width of [1440, 1180, 390]) {
        it(`gives an address that is being edited room for its fields beside its label, or puts the label below them, ${locale}, ${width}px`, async () => {
          localStorage.setItem('bault.locale', locale);
          window.location.hash = '#/profile/addresses';
          vi.mocked(api.get).mockImplementation(async (path: string) =>
            path === '/me/addresses'
              ? [address('a1', 'Home'), address('a2', 'Office')]
              : path === '/me/profile'
                ? profile
                : path === '/shipping/countries'
                  ? [{ code: 'US', name: 'United States', domestic: true, regionRequired: false }]
                  : [],
          );
          const user = userEvent.setup();
          render(
            <I18nProvider>
              <ProfilePage />
            </I18nProvider>,
          );
          // The first of the labels' two buttons is Edit, in whatever language the page is.
          const edit = await waitFor(() => {
            const button = document.querySelector<HTMLElement>('.tag-item .actions button');
            if (!button) throw new Error('the addresses have not arrived');
            return button;
          });
          await user.click(edit);
          await waitFor(() => expect(document.querySelector('.tag-item.is-editing .request-form')).not.toBeNull());
          const page = await inBrowser(width, locale);
          const [fields, slip] = await Promise.all(
            ['.tag-item.is-editing .request-form-fields', '.tag-item.is-editing .request-slip'].map((selector) =>
              page.$eval(selector, (el) => el.getBoundingClientRect().toJSON()),
            ),
          );
          // Side by side only where the fields have the room of a form; otherwise the label is between the fields
          // and the buttons, as it is on a phone.
          if (Math.abs(slip.top - fields.top) < 2) expect(fields.width).toBeGreaterThanOrEqual(440);
          else expect(slip.top).toBeGreaterThanOrEqual(fields.bottom - 1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        });
      }
    }

    it('is no wider in its fields than the password form it sits under, on a window too narrow to put them side by side', async () => {
      localStorage.setItem('bault.locale', 'en');
      window.location.hash = '#/profile/security';
      vi.mocked(api.get).mockImplementation(async (path: string) =>
        path === '/me/profile'
          ? profile
          : path === '/auth/mfa'
            ? { enabled: true, pending: false, required: false, recoveryCodesRemaining: 8 }
            : [],
      );
      render(
        <I18nProvider>
          <ProfilePage />
        </I18nProvider>,
      );
      const user = userEvent.setup();
      // Turning it off asks for the password and a code, in fields of its own: the last of the card's two buttons.
      await waitFor(() => expect(document.querySelector('.security-grid .request-form-actions button:last-child')).not.toBeNull());
      await user.click(document.querySelector('.security-grid .request-form-actions button:last-child')!);
      await waitFor(() => expect(document.querySelector('.security-grid .request-form-fields')).not.toBeNull());
      const page = await inBrowser(1024, 'en');
      const fields = await page.$eval('.security-grid .request-form-fields', (el) => el.getBoundingClientRect().width);
      expect(fields).toBeLessThanOrEqual(461);
      await page.close();
    });
  });

  describe('the sign-in log', () => {
    const at = (day: number, hour: number) => new Date(Date.UTC(2026, 8, day, hour)).toISOString();
    const log = {
      since: at(17, 0),
      last24h: { successes: 273, failures: 4, failingAddresses: 2 },
      suspicious: [],
      attempts: [
        { id: '1', occurredAt: at(18, 12), outcome: 'success', identifier: 'eldar', userId: 'u1', ip: '::ffff:127.0.0.1', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120', username: 'eldar', email: 'e@x', role: 'admin' },
        { id: '2', occurredAt: at(18, 11), outcome: 'bad_credentials', identifier: 'someone@example.com', userId: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/605 Version/17', username: null, email: null, role: null },
        { id: '3', occurredAt: at(17, 20), outcome: 'success', identifier: 'red', userId: 'u2', ip: '198.51.100.21', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605 Version/17', username: 'red', email: 'r@x', role: 'collector' },
      ],
    };

    for (const locale of ['en', 'he'] as const) {
      it(`has the three counts side by side and an attempt to a line on a wide window, one under another on a phone, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        vi.mocked(api.get).mockResolvedValue(log);
        render(
          <I18nProvider>
            <SignInsSection onError={() => {}} />
          </I18nProvider>,
        );
        await screen.findAllByText(/eldar/);
        for (const width of [1440, 390]) {
          const page = await inBrowser(width, locale);
          const counts = await page.$$eval('.ledger-col', (els) => els.map((el) => el.getBoundingClientRect().toJSON()));
          const rows = await page.$$eval('.timeline--log > li', (els) => els.map((el) => el.getBoundingClientRect().height));
          expect(counts).toHaveLength(3);
          expect(rows).toHaveLength(3);
          if (width >= 900) {
            // Side by side, all the same height; and a line to an attempt.
            expect(Math.abs(counts[0]!.top - counts[2]!.top)).toBeLessThan(2);
            expect(Math.max(...rows)).toBeLessThan(60);
          } else {
            expect(counts[1]!.top).toBeGreaterThanOrEqual(counts[0]!.bottom - 1);
            expect(counts[2]!.top).toBeGreaterThanOrEqual(counts[1]!.bottom - 1);
            expect(Math.min(...rows)).toBeGreaterThan(70);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        }
      });
    }
  });

  describe('a shipment with its slip', () => {
    const address = { id: 'a1', label: 'Home', recipient: 'Red Ashwood', line1: '12 Vine St', city: 'Trenton', region: 'NJ', country: 'US', postalCode: '08608', isDefault: true };
    const items = [{ id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza' }];

    for (const locale of ['en', 'he'] as const) {
      it(`has the slip beside the panels on a wide window and between the last two on a phone, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        vi.mocked(api.get).mockImplementation(async (path: string) =>
          path === '/shipping/services'
            ? { services: [], addOns: [], boxes: [], maxInsuredValueMinor: 100_000, signatureRequiredAboveMinor: 50_000, paymentWindowDays: 7 }
            : path === '/me/addresses'
              ? [address]
              : [],
        );
        render(
          <I18nProvider>
            <ShipmentComposer items={items} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />
          </I18nProvider>,
        );
        await screen.findByRole('region', { name: /./ });
        // The addresses arrive after the first frame: wait for them, so no update lands outside the test's own act.
        await screen.findAllByText(/Trenton/);
        for (const width of [1440, 390]) {
          const page = await inBrowser(width, locale);
          const boxes = await page.$$eval('.composer > .panel, .composer > .composer-slip', (els) =>
            els.map((el) => ({ slip: el.classList.contains('composer-slip'), ...el.getBoundingClientRect().toJSON() })),
          );
          const slip = boxes.find((b) => b.slip)!;
          const panels = boxes.filter((b) => !b.slip);
          expect(panels).toHaveLength(4);
          if (width >= 1180) {
            // Beside: on the side the page ends on, level with the first panel.
            for (const panel of panels) {
              if (locale === 'en') expect(slip.left).toBeGreaterThanOrEqual(panel.right - 1);
              else expect(slip.right).toBeLessThanOrEqual(panel.left + 1);
            }
            expect(Math.abs(slip.top - panels[0]!.top)).toBeLessThan(2);
          } else {
            // Between the panel of options and the panel of prices, as wide as they are.
            expect(slip.top).toBeGreaterThanOrEqual(panels[2]!.bottom - 1);
            expect(panels[3]!.top).toBeGreaterThanOrEqual(slip.bottom - 1);
            expect(Math.abs(slip.width - panels[2]!.width)).toBeLessThan(2);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        }
      });
    }
  });

  describe('a form with its slip', () => {
    for (const locale of ['en', 'he'] as const) {
      it(`has the slip beside the fields on a wide window and between the fields and the button on a phone, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        render(
          <I18nProvider>
            <WalletRequestForm type="cash_out" availableMinor={970000} existingRequests={[]} onSubmitted={() => {}} />
          </I18nProvider>,
        );
        for (const width of [1440, 390]) {
          const page = await inBrowser(width, locale);
          const [fields, slip, actions] = await Promise.all(
            ['.request-form-fields', '.request-slip', '.request-form-actions'].map((selector) => page.$eval(selector, (el) => el.getBoundingClientRect().toJSON())),
          );
          if (width >= 1100) {
            // Beside: on the side the page ends on, and starting where the fields start.
            if (locale === 'en') expect(slip.left).toBeGreaterThanOrEqual(fields.right - 1);
            else expect(slip.right).toBeLessThanOrEqual(fields.left + 1);
            expect(Math.abs(slip.top - fields.top)).toBeLessThan(2);
          } else {
            // Between: the fields, then the slip, then the button that sends it.
            expect(slip.top).toBeGreaterThanOrEqual(fields.bottom - 1);
            expect(actions.top).toBeGreaterThanOrEqual(slip.bottom - 1);
            expect(Math.abs(slip.width - fields.width)).toBeLessThan(2);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        }
      });
    }
  });

  describe('every other form that has one', () => {
    const PROFILE = {
      id: 'u1', email: 'red@bault.dev', username: 'red', role: 'user', status: 'active',
      firstName: 'Red', lastName: 'Ashwood', fullName: 'Red Ashwood', nameReviewRequired: false,
    };
    const answers = (more: Record<string, unknown> = {}) =>
      vi.mocked(api.get).mockImplementation(((path: string) =>
        Promise.resolve(
          path in more ? more[path] : path === '/me/profile' ? PROFILE : [],
        )) as never);
    // What the two management forms are given to show: the price list's actions, and a transaction to open a dispute on.
    const PRICING = {
      '/admin/pricing/coverage': JSON.parse(JSON.stringify(coverage(billableActions(), []))),
      '/membership/tiers': {
        tiers: MEMBERSHIP_TIERS.map((t) => ({ ...t, priceMinor: t.listPriceMinor })),
        uncovered: [],
        cycleDays: 30,
        currency: 'USD',
      },
    };
    const DISPUTES = {
      '/admin/transactions': [
        {
          id: 'c5013f0a-0000-4000-8000-000000000000',
          type: 'sale',
          price: 260,
          buyerId: 'b',
          sellerId: 's',
          createdAt: '2026-10-27T12:00:00.000Z',
        },
      ],
    };

    function Sell() {
      const t = useT();
      const items = [{ id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza' }];
      return <SellPanel items={items} t={t} onListed={async () => {}} onError={() => {}} />;
    }

    const forms: {
      name: string;
      ui: () => React.ReactElement;
      hash?: string;
      data?: Record<string, unknown>;
    }[] = [
      { name: 'selling an item', ui: () => <Sell /> },
      { name: 'proposing a trade', ui: () => <ProposeTradePanel onProposed={async () => {}} onError={() => {}} /> },
      { name: 'registering a parcel', ui: () => <RegisterParcelForm onRegistered={async () => {}} onError={() => {}} /> },
      { name: 'a new ticket', ui: () => <SupportPage />, hash: '#/support/new' },
      { name: 'the name on the account', ui: () => <ProfilePage />, hash: '#/profile/details' },
      { name: 'an address being added', ui: () => <ProfilePage />, hash: '#/profile/addresses' },
      {
        name: 'a pricing rule',
        ui: () => <AdminConsole currentUserId="me" />,
        hash: '#/admin/pricing',
        data: PRICING,
      },
      {
        name: 'a dispute being opened',
        ui: () => <AdminConsole currentUserId="me" />,
        hash: '#/admin/disputes',
        data: DISPUTES,
      },
    ];

    for (const form of forms) {
      for (const locale of ['en', 'he'] as const) {
        it(`${form.name}: the slip is beside the fields on a wide window, between the fields and the button on a phone, in ${locale}`, async () => {
          localStorage.setItem('bault.locale', locale);
          answers(form.data);
          window.location.hash = form.hash ?? '';
          render(<I18nProvider>{form.ui()}</I18nProvider>);
          // The slip is there once the form is: in whatever language the page is.
          await waitFor(() => expect(document.querySelector('.request-slip')).not.toBeNull());
          for (const width of [1440, 390]) {
            const page = await inBrowser(width, locale);
            const [fields, slip, actions] = await Promise.all(
              ['.request-form-fields', '.request-slip', '.request-form-actions'].map((selector) =>
                page.$eval(selector, (el) => el.getBoundingClientRect().toJSON()),
              ),
            );
            if (width >= 1100) {
              if (locale === 'en') expect(slip.left).toBeGreaterThanOrEqual(fields.right - 1);
              else expect(slip.right).toBeLessThanOrEqual(fields.left + 1);
              expect(Math.abs(slip.top - fields.top)).toBeLessThan(2);
              // The button is under the fields, not left at the foot of a slip that is taller than they are.
              expect(actions.top - fields.bottom).toBeLessThan(40);
            } else {
              expect(slip.top).toBeGreaterThanOrEqual(fields.bottom - 1);
              expect(actions.top).toBeGreaterThanOrEqual(slip.bottom - 1);
              expect(Math.abs(slip.width - fields.width)).toBeLessThan(2);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
            await page.close();
          }
        });
      }
    }

    for (const locale of ['en', 'he'] as const) {
      it(`the security tab is the password beside the second factor on a wide window and one under the other on a phone, with the second factor's card above what it offers, in ${locale}`, async () => {
        localStorage.setItem('bault.locale', locale);
        answers({ '/auth/mfa': { enabled: true, pending: false, required: false, recoveryCodesRemaining: 8 } });
        window.location.hash = '#/profile/security';
        render(
          <I18nProvider>
            <ProfilePage />
          </I18nProvider>,
        );
        await waitFor(() => expect(document.querySelector('.security-grid .request-slip')).not.toBeNull());
        for (const width of [1440, 390]) {
          const page = await inBrowser(width, locale);
          const [password, factor] = await Promise.all(
            ['.security-grid > :nth-child(1)', '.security-grid > :nth-child(2)'].map((selector) =>
              page.$eval(selector, (el) => el.getBoundingClientRect().toJSON()),
            ),
          );
          if (width >= 1100) {
            if (locale === 'en') expect(factor.left).toBeGreaterThanOrEqual(password.right - 1);
            else expect(factor.right).toBeLessThanOrEqual(password.left + 1);
            expect(Math.abs(factor.top - password.top)).toBeLessThan(2);
          } else {
            expect(factor.top).toBeGreaterThanOrEqual(password.bottom - 1);
          }
          // Half a page is too narrow for a form and its card side by side: the card is above what it is about, and is a card's width.
          const card = await page.$eval('.security-grid .request-slip', (el) => el.getBoundingClientRect().toJSON());
          const buttons = await page.$eval('.security-grid .request-form-actions', (el) => el.getBoundingClientRect().toJSON());
          expect(buttons.top).toBeGreaterThanOrEqual(card.bottom - 1);
          expect(card.width).toBeLessThanOrEqual(381);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
          await page.close();
        }
      });
    }
  });
});
