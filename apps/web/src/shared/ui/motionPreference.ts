/** True when the visitor has asked for less motion (or the browser cannot say). */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The `behavior` for scrollIntoView and scrollTo. An explicit 'smooth' beats the
 * stylesheet's `scroll-behavior: auto` under reduced motion, so a call that scrolls
 * has to ask this instead of saying 'smooth'.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
