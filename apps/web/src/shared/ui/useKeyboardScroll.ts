import { useEffect, type RefObject } from 'react';

/** What a person at the keyboard can stop on: a control that is there to be used. */
const STOPS =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const hasStop = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(STOPS)].some(
    (el) => !el.matches(':disabled') && (el.checkVisibility?.() ?? true),
  );

/**
 * A box that scrolls has to be reachable from the keyboard, or someone who does not use a pointer cannot read
 * what is below its fold. Where there is a control in the box, the controls are the way (focus brings each into
 * view). Where there is none (a request that is settled, a receipt, a case that is closed) the box is what takes
 * the stop, for as long as it overflows, and is named for what it holds.
 *
 * What is in a box comes and goes, and so does the room for it, so it is looked at again when either changes.
 */
export function useKeyboardScroll(ref: RefObject<HTMLElement | null>, labelledBy: string): void {
  useEffect(() => {
    const found = ref.current;
    if (!found || typeof MutationObserver === 'undefined') return;
    const box: HTMLElement = found;
    let frame = 0;
    const watched = new Set<Element>();
    const sizes =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());

    const sync = () => {
      frame = 0;
      // The box is as tall as what is in it, so what is in it is what is watched for a change of size.
      for (const el of watched) {
        if (!el.isConnected) {
          sizes?.unobserve(el);
          watched.delete(el);
        }
      }
      for (const child of box.children) {
        if (watched.has(child)) continue;
        watched.add(child);
        sizes?.observe(child);
      }
      const needed = box.scrollHeight > box.clientHeight + 1 && !hasStop(box);
      const set = box.dataset.scrollable === 'true';
      if (needed && !set) {
        box.tabIndex = 0;
        box.setAttribute('role', 'region');
        box.setAttribute('aria-labelledby', labelledBy);
        box.dataset.scrollable = 'true';
      } else if (!needed && set) {
        box.removeAttribute('tabindex');
        box.removeAttribute('role');
        box.removeAttribute('aria-labelledby');
        delete box.dataset.scrollable;
      }
    };

    function schedule() {
      if (!frame) frame = requestAnimationFrame(sync);
    }

    sizes?.observe(box);
    const changes = new MutationObserver(schedule);
    changes.observe(box, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'open'],
    });
    window.addEventListener('resize', schedule);
    // Widths change when the fonts arrive, and with them how tall the words are.
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      changes.disconnect();
      sizes?.disconnect();
      watched.clear();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, labelledBy]);
}
