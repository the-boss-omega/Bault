import { useEffect } from 'react';

const SELECTOR = '.dt-wrap';

/** What a person who cannot see the table would be told it is: its caption, or the heading of the panel it is in. */
function nameOf(el: HTMLElement): string | null {
  const caption = el.querySelector('caption')?.textContent?.trim();
  if (caption) return caption;
  return el.closest('.panel')?.querySelector('.panel-title')?.textContent?.trim() || null;
}

/**
 * A table that is wider than its room scrolls sideways, and what scrolls has to be
 * reachable from the keyboard, or someone who does not use a pointer cannot read the
 * columns that are out of sight. This puts a scrolling table in the tab order, with a
 * name, while it overflows, and takes it out again when it fits (a phone turned on its
 * side, a window made wider).
 *
 * It is done from outside the tables because there are a score of them, written one by
 * one, and none of them knows how wide the room will be.
 */
export function useScrollableRegions(): void {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    let frame = 0;

    const sync = () => {
      frame = 0;
      for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
        const scrolls = el.scrollWidth > el.clientWidth + 1;
        if (scrolls && el.dataset.scrollable !== 'true' && !el.hasAttribute('tabindex')) {
          el.tabIndex = 0;
          el.dataset.scrollable = 'true';
          const name = nameOf(el);
          if (name && !el.hasAttribute('role')) {
            el.setAttribute('role', 'region');
            el.setAttribute('aria-label', name);
          }
        } else if (!scrolls && el.dataset.scrollable === 'true') {
          el.removeAttribute('tabindex');
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
          delete el.dataset.scrollable;
        }
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

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
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
