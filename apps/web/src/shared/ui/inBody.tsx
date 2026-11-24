import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Overlays are drawn into the body, not where they are asked for. A fixed element sits in the window only
 * while nothing above it has a transform, a filter or containment, and the places an overlay is asked for
 * always do: a card that lifts when it is pointed at, a drawer that has slid in. Drawn into the body it
 * covers the window whichever of those it was asked from.
 */
export function inBody(node: ReactNode) {
  return createPortal(node, document.body);
}
