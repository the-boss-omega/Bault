import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * The landing page's motion, in one place.
 *
 * - `lp-js` is put on the root only when IntersectionObserver exists, and the
 *   CSS hides things for reveal only under that class, so a browser without it
 *   (or a test renderer) shows everything.
 * - Anything with `data-reveal` gets `is-visible` the first time it scrolls in.
 * - The header gains `is-scrolled` once the page has moved.
 * - The card fan follows the pointer a little, as if it were on a shelf in a room.
 * - The journey section learns which of its steps is centred, so the card beside
 *   it can be in the right state.
 */
export function useLandingMotion(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cleanups: (() => void)[] = [];
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (typeof IntersectionObserver !== 'undefined') {
      el.classList.add('lp-js');

      const reveal = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            reveal.unobserve(entry.target);
          }
        },
        { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
      );
      el.querySelectorAll<HTMLElement>('[data-reveal]').forEach((node) => reveal.observe(node));
      cleanups.push(() => reveal.disconnect());

      const journey = el.querySelector<HTMLElement>('.lp-journey');
      const steps = Array.from(el.querySelectorAll<HTMLElement>('.lp-steps .step'));
      if (journey && steps.length > 0) {
        const stage = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) journey.dataset.stage = entry.target.getAttribute('data-step') ?? '1';
            }
          },
          { rootMargin: '-45% 0px -45% 0px' },
        );
        steps.forEach((step) => stage.observe(step));
        cleanups.push(() => stage.disconnect());
      }
    }

    const onScroll = () => {
      el.classList.toggle('is-scrolled', window.scrollY > 24);
      const span = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty('--sp', span > 0 ? String(Math.min(1, window.scrollY / span)) : '0');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', onScroll));

    const hero = el.querySelector<HTMLElement>('.lp-hero');
    const fan = el.querySelector<HTMLElement>('.lp-hero .lp-fan');
    if (hero && fan && !reduced) {
      const onMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return;
        const box = hero.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width - 0.5) * 2;
        const y = ((event.clientY - box.top) / box.height - 0.5) * 2;
        fan.style.setProperty('--fx', x.toFixed(3));
        fan.style.setProperty('--fy', y.toFixed(3));
      };
      const onLeave = () => {
        fan.style.setProperty('--fx', '0');
        fan.style.setProperty('--fy', '0');
      };
      hero.addEventListener('pointermove', onMove);
      hero.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        hero.removeEventListener('pointermove', onMove);
        hero.removeEventListener('pointerleave', onLeave);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [root]);
}
