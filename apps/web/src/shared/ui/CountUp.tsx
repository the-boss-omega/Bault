import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from './motionPreference';

const NUMBER = /^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;
const DURATION = 900;

/**
 * Renders `value` and, once it is on screen, counts the first number in it up
 * from zero. The text React renders is always the final one, so a browser that
 * skips the animation (reduced motion, no matchMedia or IntersectionObserver, a
 * test renderer) shows the right thing at once.
 *
 * The animation writes into the element it renders, so it must never leave its
 * own text behind: React commits the next value first and only then runs the
 * previous effect's cleanup, and a cleanup that wrote its (old) value back would
 * put a stale balance on screen. The cleanup therefore only cancels; every run
 * of the effect begins by writing the value it was given.
 */
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = value;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) return;
    const match = NUMBER.exec(value);
    if (!match) return;
    const [, prefix = '', digits = '', suffix = ''] = match;
    const target = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = digits.includes('.') ? (digits.split('.')[1]?.length ?? 0) : 0;
    const format = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    let frame = 0;
    let io: IntersectionObserver | undefined;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / DURATION);
        const eased = 1 - (1 - p) ** 3;
        el.textContent = p >= 1 ? value : `${prefix}${format(target * eased)}${suffix}`;
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      // The first frame is written before paint, so a figure that is already on
      // screen starts at zero instead of flashing its final value first.
      tick(start);
    };

    const box = el.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight) {
      run();
    } else {
      io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io?.disconnect();
        run();
      });
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return <span ref={ref}>{value}</span>;
}
