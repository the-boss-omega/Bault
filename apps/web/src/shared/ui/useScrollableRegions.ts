import { useEffect } from 'react';

const SELECTOR = '.dt-wrap';
const HEADINGS = 'h2, h3, h4, .panel-title';

/**
 * What a person who cannot see the table would be told it is: its caption, or the
 * nearest heading above it (its own section's, then its panel's), so two tables in
 * one panel are not both called by the panel's name.
 */
function nameOf(el: HTMLElement): string | null {
  const caption = el.querySelector('caption')?.textContent?.trim();
  if (caption) return caption;
  for (let node: Element | null = el; node && !node.matches('.panel'); node = node.parentElement) {
    for (let before = node.previousElementSibling; before; before = before.previousElementSibling) {
      const heading = before.matches(HEADINGS) ? before : [...before.querySelectorAll(HEADINGS)].pop();
      const text = heading?.textContent?.trim();
      if (text) return text;
    }
  }
  return el.closest('.panel')?.querySelector('.panel-title')?.textContent?.trim() || null;
}

/**
 * A table that is wider than its room scrolls sideways, and what scrolls has to be
 * reachable from the keyboard, or someone who does not use a pointer cannot read the
 * columns that are out of sight. This puts a scrolling table in the tab order, with a
 * name, while it overflows, and takes it out again when it fits (a phone turned on its
 * side, a window made wider, a drawer opening beside it).
 *
 * It is done from outside the tables because there are a score of them, written one by
 * one, and none of them knows how wide its room will be. `language` is only there to
 * run the check again when the words change, so a name is never left in the old one.
 */
export function useScrollableRegions(language: string): void {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    let frame = 0;
    const watched = new Set<Element>();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    const watch = (el: Element) => {
      if (watched.has(el)) return;
      watched.add(el);
      sizes?.observe(el);
    };

    function sync() {
      frame = 0;
      for (const el of watched) {
        if (!el.isConnected) {
          sizes?.unobserve(el);
          watched.delete(el);
        }
      }
      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        // A placeholder that is hidden from assistive technology is not a place to stop.
        if (el.closest('[aria-hidden="true"]')) continue;
        watch(el);
        const table = el.querySelector('table');
        if (table) watch(table);

        const scrolls = el.scrollWidth > el.clientWidth + 1;
        const name = nameOf(el);
        if (scrolls && el.dataset.scrollable !== 'true' && !el.hasAttribute('tabindex')) {
          el.tabIndex = 0;
          el.dataset.scrollable = 'true';
          if (name && !el.hasAttribute('role')) el.setAttribute('role', 'region');
        } else if (!scrolls && el.dataset.scrollable === 'true') {
          el.removeAttribute('tabindex');
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
          delete el.dataset.scrollable;
        }
        // The name is read again on every pass, so a change of language reaches it.
        if (el.dataset.scrollable === 'true' && el.getAttribute('role') === 'region' && name) {
          el.setAttribute('aria-label', name);
        }
      }
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(sync);
    }

    // A figure counting up, a toast, a drawer opening: none of them can change how wide a table is, so
    // only a change inside a table, or the arrival of one, is worth a measurement (which is a layout).
    const involvesATable = (record: MutationRecord) => {
      if (record.target instanceof Element && record.target.closest(SELECTOR)) return true;
      for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches(SELECTOR) || node.querySelector(SELECTOR))) return true;
      }
      return false;
    };
    const observer = new MutationObserver((records) => {
      if (records.some(involvesATable)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    // Widths change when the fonts arrive.
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      observer.disconnect();
      sizes?.disconnect();
      watched.clear();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [language]);
}
