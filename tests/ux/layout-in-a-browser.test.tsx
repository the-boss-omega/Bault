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
const { PageHeader, NotificationBell, LanguageSwitcher } = await import('../../apps/web/src/shared/ui/PageHeader');
const { NavigationRail } = await import('../../apps/web/src/shared/ui/NavigationRail');
const { ContextTabs } = await import('../../apps/web/src/shared/ui/primitives');
const { StatementSlip } = await import('../../apps/web/src/areas/customer/finance/StatementSlip');
const { AccountingSection } = await import('../../apps/web/src/areas/admin/AccountingSection');
const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { WalletRequestForm } = await import('../../apps/web/src/areas/customer/finance/WalletRequestForms');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');
const { SignInsSection } = await import('../../apps/web/src/areas/admin/SignInsSection');
const { api } = await import('../../apps/web/src/shared/api');
const audit = (await import('../../scripts/lib/audit-checks.mjs')) as unknown as {
  auditFocus: (page: Page, stops?: number) => Promise<string[]>;
};

/**
 * What the tests above cannot say, because jsdom lays nothing out: whether an overlay covers the window, a
 * menu can be clicked, a closed sheet is out of the way of the keyboard, a focus ring is cut off. The real
 * markup of the real components is rendered here, taken out of jsdom as the HTML it is, and put in a
 * browser with the real stylesheets. No server, no data, no bundle: what is measured is the markup and the
 * CSS, which is where each of these was wrong.
 */
const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const CSS = ['index', 'theme', 'slab', 'components', 'landing', 'app', 'gallery', 'screens', 'motion']
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
        // WCAG 2.2, 2.5.8: a target is at least 24 by 24 CSS pixels (this one is 36).
        expect(close.width).toBeGreaterThanOrEqual(36);
        expect(close.height).toBeGreaterThanOrEqual(36);
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

    for (const locale of ['en', 'he'] as const) {
      for (const width of [1440, 390]) {
        it(`shows a control whole with its ring wherever the table has scrolled to, ${locale}, ${width}px`, async () => {
          localStorage.setItem('bault.locale', locale);
          window.location.hash = '#/admin/users';
          vi.mocked(api.get).mockImplementation(async (path: string) =>
            path === '/admin/users' ? [user('u1', 'eldar', true), user('u2', 'hermon', true), user('u3', 'red', false)] : [],
          );
          render(
            <I18nProvider>
              <AdminConsole currentUserId="me" />
            </I18nProvider>,
          );
          await screen.findByDisplayValue('Eldar');
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
});
