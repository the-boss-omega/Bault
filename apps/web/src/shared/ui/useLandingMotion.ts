import { useEffect } from 'react';
import type { RefObject } from 'react';

const REVEAL = [
  '.landing-section',
  '.landing-close',
  '.landing-claims article',
  '.landing-steps .step',
  '.landing-price-table tbody tr',
  '.landing-footnote',
].join(',');

/**
 * Scroll reveal and pointer glow for the landing page.
 *
 * The `reveal` class is added here, not in markup, so a browser without
 * IntersectionObserver (or a test renderer) simply shows everything.
 */
export function useLandingMotion(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const cleanups: (() => void)[] = [];

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      );
      el.querySelectorAll<HTMLElement>(REVEAL).forEach((node) => {
        const siblings = node.parentElement ? Array.from(node.parentElement.children) : [];
        node.style.setProperty('--reveal-delay', `${Math.min(siblings.indexOf(node), 5) * 80}ms`);
        node.classList.add('reveal');
        io.observe(node);
      });
      cleanups.push(() => io.disconnect());
    }

    const onMove = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '.landing-claims article, .landing-stage-photo, .landing-close',
      );
      if (!target) return;
      const box = target.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      target.style.setProperty('--mx', `${x}px`);
      target.style.setProperty('--my', `${y}px`);
      if (target.classList.contains('landing-stage-photo')) {
        target.style.setProperty('--ry', `${((x / box.width) - 0.5) * 14}deg`);
        target.style.setProperty('--rx', `${((y / box.height) - 0.5) * -14}deg`);
      }
    };
    const onLeave = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.landing-stage-photo');
      target?.style.setProperty('--rx', '0deg');
      target?.style.setProperty('--ry', '0deg');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerout', onLeave);
    cleanups.push(() => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerout', onLeave);
    });

    return () => cleanups.forEach((fn) => fn());
  }, [root]);
}
