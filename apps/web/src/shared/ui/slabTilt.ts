import type { PointerEvent } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Tilts a slab toward the pointer and moves its foil sheen with it.
 *
 * The pointer position is written as unitless -1..1 custom properties on the
 * slab's case; the CSS decides how far that turns it. Nothing is stored in
 * React state, so a hovering pointer never re-renders anything.
 */
export function slabMove(event: PointerEvent<HTMLElement>): void {
  if (event.pointerType === 'touch' || prefersReducedMotion()) return;
  const host = event.currentTarget;
  const slab = host.querySelector<HTMLElement>('.slab-case, .tilt-case');
  if (!slab) return;
  const box = host.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  const py = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
  slab.style.setProperty('--px', px.toFixed(3));
  slab.style.setProperty('--py', py.toFixed(3));
  slab.style.setProperty('--tx', ((px - 0.5) * 2).toFixed(3));
  slab.style.setProperty('--ty', ((0.5 - py) * 2).toFixed(3));
  slab.dataset.live = 'true';
}

export function slabLeave(event: PointerEvent<HTMLElement>): void {
  const slab = event.currentTarget.querySelector<HTMLElement>('.slab-case, .tilt-case');
  if (!slab) return;
  for (const name of ['--px', '--py', '--tx', '--ty']) slab.style.removeProperty(name);
  delete slab.dataset.live;
}
