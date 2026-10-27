import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const { useScrollableRegions } = await import('../../apps/web/src/shared/ui/useScrollableRegions');

function Page({ withCaption = false }: { withCaption?: boolean }) {
  useScrollableRegions();
  return (
    <section className="panel">
      <h2 className="panel-title">My deals</h2>
      <div className="dt-wrap" data-testid="wrap">
        <table className="data-table">
          {withCaption && <caption>Open deals</caption>}
          <tbody>
            <tr>
              <td>one</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** jsdom has no layout, so a table's width and its room are whatever the test says they are. */
function size(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
}

/** The check runs on the next frame. */
async function resized() {
  window.dispatchEvent(new Event('resize'));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('a table that scrolls sideways can be reached from the keyboard', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts a table that overflows in the tab order, named for the panel it is in', async () => {
    const { getByTestId } = render(<Page />);
    const wrap = getByTestId('wrap');
    expect(wrap).not.toHaveAttribute('tabindex');

    size(wrap, 640, 320);
    await resized();

    expect(wrap).toHaveAttribute('tabindex', '0');
    expect(wrap).toHaveAttribute('role', 'region');
    expect(wrap).toHaveAttribute('aria-label', 'My deals');
  });

  it('names it for its caption when it has one', async () => {
    const { getByTestId } = render(<Page withCaption />);
    const wrap = getByTestId('wrap');

    size(wrap, 640, 320);
    await resized();

    expect(wrap).toHaveAttribute('aria-label', 'Open deals');
  });

  it('takes it out again when the room is wide enough for it', async () => {
    const { getByTestId } = render(<Page />);
    const wrap = getByTestId('wrap');

    size(wrap, 640, 320);
    await resized();
    expect(wrap).toHaveAttribute('tabindex', '0');

    size(wrap, 640, 900);
    await resized();

    expect(wrap).not.toHaveAttribute('tabindex');
    expect(wrap).not.toHaveAttribute('role');
    expect(wrap).not.toHaveAttribute('aria-label');
  });

  it('leaves a table that fits alone', async () => {
    const { getByTestId } = render(<Page />);
    const wrap = getByTestId('wrap');

    size(wrap, 320, 320);
    await resized();

    expect(wrap).not.toHaveAttribute('tabindex');
  });

  it('does not take over a tab stop the table already has', async () => {
    const { getByTestId } = render(<Page />);
    const wrap = getByTestId('wrap');
    wrap.setAttribute('tabindex', '-1');

    size(wrap, 640, 320);
    await resized();
    expect(wrap).toHaveAttribute('tabindex', '-1');

    size(wrap, 320, 320);
    await resized();
    expect(wrap).toHaveAttribute('tabindex', '-1');
  });
});
