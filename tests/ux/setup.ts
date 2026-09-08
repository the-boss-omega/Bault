import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Setup for the rendering suite.
 *
 * `cleanup` between cases is not optional: Testing Library mounts into a
 * document that persists across tests in the same file, so without it the second
 * test in a file queries a DOM containing the first test's component as well and
 * `getByRole` throws "found multiple elements" for reasons that have nothing to
 * do with the component under test.
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements neither of these, and both are called by the shell on mount —
 * `matchMedia` by the mobile-layout hook, `scrollTo` by the router on navigation.
 * Without them every render of the app shell throws before a single assertion.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!window.scrollTo) {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}
/**
 * jsdom implements no scrolling at all, and the receiving bench brings the
 * intake form into view when an operator presses "Book contents" on a box. The
 * call site is optional-called so a missing implementation cannot break the
 * click; this stub keeps the console quiet as well.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

/**
 * Run every rendering test in English.
 *
 * `DEFAULT_LOCALE` is Hebrew, which is right for the product and wrong for a
 * test file: assertions would have to match Hebrew strings, and a reader of the
 * test could not tell what the screen says. `I18nProvider` reads its initial
 * locale from this key, so setting it once here makes every query in the suite
 * legible. The catalogue itself is covered by `tests/web/i18n-catalogue.test.ts`,
 * which is where translation coverage belongs.
 */
import { beforeEach } from 'vitest';
beforeEach(() => {
  localStorage.setItem('bault.locale', 'en');
});
