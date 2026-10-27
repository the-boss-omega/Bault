/* global document, localStorage, matchMedia */
/*
 * Sets the theme and the language before the first paint, so a page that is light opens light
 * instead of dark and then flipping, and an English page opens left to right instead of right to
 * left and then flipping. It is a file of its own, not an inline script, because the page's content
 * security policy allows scripts only from its own origin; and it runs before anything is drawn,
 * because it is in the head and blocks. It does what the two providers do at start, and no more:
 * the choices are the ones stored under bault.theme (light, dark or system) and bault.locale (he
 * or en); the page's own defaults (dark, Hebrew) stand where there is none.
 */
(function () {
  var root = document.documentElement;
  var choice = null;
  var locale = null;
  try {
    choice = localStorage.getItem('bault.theme');
    locale = localStorage.getItem('bault.locale');
  } catch {
    /* storage can be blocked; the page's own defaults stand */
  }
  if (locale === 'he' || locale === 'en') {
    root.setAttribute('lang', locale);
    root.setAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
  }
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else if (choice === 'system') root.removeAttribute('data-theme');

  var dark = root.getAttribute('data-theme') !== 'light';
  if (!root.hasAttribute('data-theme') && typeof matchMedia === 'function') {
    dark = matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // The browser's own chrome (the address bar on a phone) takes the colour of the page.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
})();
