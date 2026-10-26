import { useEffect, useRef } from 'react';

const NUMBER = /^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;

/**
 * Renders `value` and, once it is on screen, counts the first number in it up
 * from zero. The final text is what React renders, so a browser that skips the
 * animation (reduced motion, no matchMedia, a test renderer) shows the right
 * thing at once.
 */
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window.matchMedia !== 'function' || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const match = NUMBER.exec(value);
    if (!match) return;
    const [, prefix = '', digits = '', suffix = ''] = match;
    const target = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = digits.includes('.') ? (digits.split('.')[1]?.length ?? 0) : 0;
    const format = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

    let frame = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const start = performance.now();
      const duration = 900;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 3;
        el.textContent = p >= 1 ? value : `${prefix}${format(target * eased)}${suffix}`;
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      el.textContent = value;
    };
  }, [value]);

  return <span ref={ref}>{value}</span>;
}
