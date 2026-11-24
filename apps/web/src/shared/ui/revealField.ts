/**
 * A field that takes focus in a box that scrolls is shown whole, with room for its ring. The browser reveals
 * only the caret of a text field, so a text area half under the fold of a drawer stays half under it, and the
 * ring drawn round it is cut off by the edge of the box. The box's own `scroll-padding` is the room.
 *
 * It stands alone, with nothing imported, because the layout test runs this very function in a browser.
 */
export function revealField(
  target: HTMLElement,
  panel: HTMLElement,
  behavior: ScrollBehavior,
): void {
  // How far a focus ring reaches outside the control it rings (its width and its offset), and a little more.
  const ring = 6;
  let scroller: HTMLElement | null = null;
  for (let el = target.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      scroller = el;
      break;
    }
    if (el === panel) break;
  }
  if (!scroller) return;
  const room = scroller.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  if (box.top - ring >= room.top && box.bottom + ring <= room.bottom) return;
  target.scrollIntoView?.({ block: 'nearest', behavior });
}
