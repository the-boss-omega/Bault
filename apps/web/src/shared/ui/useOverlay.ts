import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlays: symbol[] = [];

function pushOverlay(token: symbol): () => void {
  overlays.push(token);
  return () => {
    const at = overlays.indexOf(token);
    if (at >= 0) overlays.splice(at, 1);
  };
}

const isTopOverlay = (token: symbol) => overlays[overlays.length - 1] === token;

function trapTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (nodes.length === 0) {
    event.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * What every dialog shares. While it is the topmost one it is all the keyboard
 * reaches: Tab stays inside it and Escape asks it to close (and nothing under
 * it). The page behind does not scroll, and focus goes back to whatever opened
 * it. `onEscape` must be stable; the effect re-runs when it changes.
 */
export function useOverlay(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const token = Symbol('overlay');
    const popOverlay = pushOverlay(token);
    panel?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopOverlay(token)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
        return;
      }
      trapTab(event, panel);
    }

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      popOverlay();
      opener?.focus?.();
    };
  }, [ref, onEscape]);
}
