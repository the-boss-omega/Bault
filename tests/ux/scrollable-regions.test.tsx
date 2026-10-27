import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const { useScrollableRegions } = await import('../../apps/web/src/shared/ui/useScrollableRegions');

function Page({ withCaption = false, language = 'en' }: { withCaption?: boolean; language?: string }) {
  useScrollableRegions(language);
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

  it('measures when something changes in or around a table, and not for anything else', async () => {
    const { getByTestId } = render(<Page />);
    const wrap = getByTestId('wrap');
    let reads = 0;
    Object.defineProperty(wrap, 'scrollWidth', {
      configurable: true,
      get: () => {
        reads += 1;
        return 320;
      },
    });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 320 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const settled = reads;

    // A figure counting up, somewhere else on the page.
    const elsewhere = document.createElement('p');
    const aside = document.createElement('aside');
    aside.appendChild(elsewhere);
    document.body.appendChild(aside);
    elsewhere.textContent = '1';
    elsewhere.textContent = '2';
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBe(settled);

    // A row arriving in the table.
    wrap.querySelector('tbody')!.appendChild(document.createElement('tr'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reads).toBeGreaterThan(settled);
    aside.remove();
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

  it('names each of two tables in a panel by the heading just above it, not both by the panel', async () => {
    function Two() {
      useScrollableRegions('en');
      return (
        <section className="panel">
          <h2 className="panel-title">Preferences</h2>
          <h3>Offers</h3>
          <div className="dt-wrap" data-testid="first">
            <table>
              <tbody>
                <tr>
                  <td>a</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>Shipments</h3>
          <div className="dt-wrap" data-testid="second">
            <table>
              <tbody>
                <tr>
                  <td>b</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    const { getByTestId } = render(<Two />);
    size(getByTestId('first'), 640, 320);
    size(getByTestId('second'), 640, 320);
    await resized();

    expect(getByTestId('first')).toHaveAttribute('aria-label', 'Offers');
    expect(getByTestId('second')).toHaveAttribute('aria-label', 'Shipments');
  });

  it('leaves a placeholder that is hidden from assistive technology out of the tab order', async () => {
    function Loading() {
      useScrollableRegions('en');
      return (
        <div aria-hidden="true">
          <div className="dt-wrap" data-testid="skeleton">
            <table>
              <tbody>
                <tr>
                  <td>…</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    const { getByTestId } = render(<Loading />);
    size(getByTestId('skeleton'), 640, 320);
    await resized();

    expect(getByTestId('skeleton')).not.toHaveAttribute('tabindex');
  });

  it('gives a table its name again in the new language', async () => {
    function Titled({ language, title }: { language: string; title: string }) {
      useScrollableRegions(language);
      return (
        <section className="panel">
          <h2 className="panel-title">{title}</h2>
          <div className="dt-wrap" data-testid="wrap">
            <table>
              <tbody>
                <tr>
                  <td>a</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    const { getByTestId, rerender } = render(<Titled language="en" title="My deals" />);
    const wrap = getByTestId('wrap');
    size(wrap, 640, 320);
    await resized();
    expect(wrap).toHaveAttribute('aria-label', 'My deals');

    rerender(<Titled language="he" title="העסקאות שלי" />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(wrap).toHaveAttribute('aria-label', 'העסקאות שלי');
  });
});
