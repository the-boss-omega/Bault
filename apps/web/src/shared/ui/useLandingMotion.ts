import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Entrance motion may start from a hidden state only where something is
 * certain to undo it. `lp-js` is that promise: it is put on the element only
 * when IntersectionObserver exists, and the CSS hides things for reveal only
 * under that class, so a browser without it (or a test renderer) shows
 * everything. It is added before the first paint, so there is no frame in which
 * the page is visible and then hides.
 */
export function useMotionReady(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    el.classList.add('lp-js');
    return () => el.classList.remove('lp-js');
  }, [root]);
}

/**
 * The landing page's motion, in one place.
 *
 * - Anything with `data-reveal` gets `is-visible` the first time it scrolls in.
 * - The header gains `is-scrolled` once the page has moved, and the progress
 *   hairline learns how far down the page is. The distance is written to that
 *   one element, not to the page root: a custom property set on the root
 *   restyles every descendant on every scroll frame.
 * - The card fan follows the pointer a little, as if it were on a shelf in a room.
 * - The hero is told when it has scrolled out of view, so its idle motion stops
 *   spending frames on something nobody can see.
 * - The journey section learns which of its steps is centred, so the card beside
 *   it can be in the right state.
 */
export function useLandingMotion(root: RefObject<HTMLElement | null>): void {
  useMotionReady(root);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cleanups: (() => void)[] = [];
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (typeof IntersectionObserver !== 'undefined') {
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

      const heroEl = el.querySelector<HTMLElement>('.lp-hero');
      if (heroEl) {
        const watch = new IntersectionObserver((entries) => {
          for (const entry of entries) heroEl.classList.toggle('is-offscreen', !entry.isIntersecting);
        });
        watch.observe(heroEl);
        cleanups.push(() => watch.disconnect());
      }
    }

    const progress = el.querySelector<HTMLElement>('.lp-progress');
    let frame = 0;
    const update = () => {
      frame = 0;
      el.classList.toggle('is-scrolled', window.scrollY > 24);
      const span = document.documentElement.scrollHeight - window.innerHeight;
      progress?.style.setProperty('--sp', span > 0 ? String(Math.min(1, window.scrollY / span)) : '0');
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    });

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
