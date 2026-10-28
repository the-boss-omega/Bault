import { useEffect, type RefObject } from 'react';
import { scrollBehavior } from './motionPreference';
import { revealField } from './revealField';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const overlays: symbol[] = [];
const panels = new Map<symbol, HTMLElement>();

function pushOverlay(token: symbol, panel: HTMLElement | null): () => void {
  overlays.push(token);
  if (panel) panels.set(token, panel);
  return () => {
    const at = overlays.indexOf(token);
    if (at >= 0) overlays.splice(at, 1);
    panels.delete(token);
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
 * it; if that is gone (the button that asked was the thing the answer removed),
 * to the dialog it was opened over, so the keyboard is not left on the page
 * behind. A field that takes focus in a dialog that scrolls is shown whole: the
 * browser reveals only its caret, so a text area half under the fold stayed half
 * under it, with its ring cut off. `onEscape` must be stable; the effect re-runs
 * when it changes.
 */
export function useOverlay(ref: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const token = Symbol('overlay');
    const popOverlay = pushOverlay(token, panel);
    panel?.focus();

    function reveal(event: FocusEvent) {
      if (event.target instanceof HTMLElement && panel)
        revealField(event.target, panel, scrollBehavior());
    }
    panel?.addEventListener('focusin', reveal);

    // A control the dialog removes takes focus with it, to the page behind the backdrop: the button that was
    // just pressed, whose answer replaces it (Approve, once approved). The dialog takes focus back, or Tab
    // would walk the page under it.
    const keepFocus = new MutationObserver(() => {
      const active = document.activeElement;
      if (panel && isTopOverlay(token) && (!active || active === document.body)) panel.focus();
    });
    if (panel) keepFocus.observe(panel, { childList: true, subtree: true });

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
      panel?.removeEventListener('focusin', reveal);
      keepFocus.disconnect();
      document.body.style.overflow = previousOverflow;
      popOverlay();
      if (opener?.isConnected) opener.focus?.();
      else panels.get(overlays[overlays.length - 1]!)?.focus();
    };
  }, [ref, onEscape]);
}
