/* global document, localStorage, matchMedia */
/*
 * Sets the theme before the first paint, so a page that is light opens light instead of dark and
 * then flipping. It is a file of its own, not an inline script, because the page's content security
 * policy allows scripts only from its own origin; and it runs before anything is drawn, because it
 * is in the head and blocks. It does what the theme provider does at start, and no more: the choice
 * is the one stored under bault.theme (light, dark or system); the page's own default (dark) stands
 * where there is none.
 */
(function () {
  var root = document.documentElement;
  var choice = null;
  try {
    choice = localStorage.getItem('bault.theme');
  } catch {
    /* storage can be blocked; the page's own default stands */
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
