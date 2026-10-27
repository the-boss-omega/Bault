import { useCallback, useEffect, useRef, useState } from 'react';

const FALLBACK_MS = 180;

/** How long the exit animation runs, read from the stylesheet so `--dur-exit` is the one place it is set. */
function exitMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-exit').trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return FALLBACK_MS;
  return raw.endsWith('ms') ? n : n * 1000;
}

/**
 * Plays the exit animation, then closes: `closing` puts `.is-closing` on the
 * overlay and `onClose` runs when the animation is done.
 *
 * Without matchMedia, or under reduced motion, it closes at once. (The UX
 * tests' matchMedia mock answers "no" to every query, so they do take the
 * animated path.) Asking twice while it plays does nothing, and a timer still
 * pending when the overlay unmounts is cancelled, so `onClose` never fires for
 * something that is already gone.
 */
export function useExit(onClose: () => void): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const requestClose = useCallback(() => {
    if (timer.current !== undefined) return;
    const animate =
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate) {
      latest.current();
      return;
    }
    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      latest.current();
      // A parent that does not unmount us after all gets the overlay back.
      setClosing(false);
    }, exitMs());
  }, []);

  return { closing, requestClose };
}
