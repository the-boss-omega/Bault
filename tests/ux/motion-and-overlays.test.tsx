import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';

const { CountUp } = await import('../../apps/web/src/shared/ui/CountUp');
const { useExit } = await import('../../apps/web/src/shared/ui/useExit');
const { useOverlay } = await import('../../apps/web/src/shared/ui/useOverlay');
const { ContextTabs } = await import('../../apps/web/src/shared/ui/primitives');
const { useLandingMotion, useMotionReady } = await import('../../apps/web/src/shared/ui/useLandingMotion');
const { prefersReducedMotion, scrollBehavior } = await import('../../apps/web/src/shared/ui/motionPreference');

/** matchMedia that answers "yes" only to a reduced-motion query. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** An IntersectionObserver the test can fire by hand. */
const observers: FakeObserver[] = [];
class FakeObserver {
  elements: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(el: Element) {
    this.elements.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(intersecting = true) {
    this.callback(
      this.elements.map((target) => ({ isIntersecting: intersecting, target }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

function installObserver() {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
}

beforeEach(() => {
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.dir = '';
});

/** A rectangle, without depending on jsdom having DOMRect. */
function box(left: number, width: number): DOMRect {
  return { left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

describe('reading the motion preference', () => {
  it('scrolls smoothly only when nothing has been asked of it', () => {
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });
});

describe('CountUp', () => {
  it('shows the final figure at once where it cannot animate', () => {
    render(<CountUp value="$1,234.50" />);
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
  });

  it('shows the final figure at once under reduced motion, and never builds an observer', () => {
    installObserver();
    setReducedMotion(true);
    render(<CountUp value="$1,234.50" />);
    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
    expect(observers).toHaveLength(0);
  });

  it('counts up from zero when it scrolls into view, and ends on exactly its value', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    installObserver();
    render(<CountUp value="$1,234.50" />);
    const el = screen.getByText('$1,234.50');

    act(() => observers[0]!.fire());
    expect(el.textContent).toBe('$0.00');

    act(() => {
      vi.advanceTimersByTime(450);
    });
    const midway = Number(el.textContent!.replace(/[$,]/g, ''));
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1234.5);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(el.textContent).toBe('$1,234.50');
  });

  it('never leaves an old balance on screen when the value changes to zero', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    installObserver();
    const { rerender } = render(<CountUp value="$5.00" />);
    act(() => observers[0]!.fire());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('$5.00')).toBeInTheDocument();

    // A pending balance is approved: the figure becomes zero, which does not animate.
    rerender(<CountUp value="$0.00" />);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByText('$5.00')).not.toBeInTheDocument();
  });

  it('never leaves an old balance on screen when the value changes mid-count or before it is seen', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    installObserver();
    const { rerender, container } = render(<CountUp value="$100.00" />);
    // Not yet seen: the figure changes before the observer ever fires.
    rerender(<CountUp value="$250.00" />);
    expect(container.textContent).toBe('$250.00');

    act(() => observers[observers.length - 1]!.fire());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Mid-count: the figure changes again.
    rerender(<CountUp value="$40.00" />);
    expect(container.textContent).toBe('$40.00');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toBe('$40.00');
  });

  it('leaves a figure with no number in it alone', () => {
    installObserver();
    render(<CountUp value="—" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

function Closer({ onClose }: { onClose: () => void }) {
  const { closing, requestClose } = useExit(onClose);
  return (
    <div data-testid="overlay" className={closing ? 'is-closing' : ''}>
      <button type="button" onClick={requestClose}>
        close
      </button>
    </div>
  );
}

describe('useExit', () => {
  it('plays the exit, then closes once, however often it is asked', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Closer onClose={onClose} />);

    act(() => screen.getByText('close').click());
    expect(screen.getByTestId('overlay')).toHaveClass('is-closing');
    expect(onClose).not.toHaveBeenCalled();

    act(() => screen.getByText('close').click());
    act(() => {
      vi.advanceTimersByTime(179);
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes at once under reduced motion', () => {
    setReducedMotion(true);
    const onClose = vi.fn();
    render(<Closer onClose={onClose} />);
    act(() => screen.getByText('close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('overlay')).not.toHaveClass('is-closing');
  });

  it('does not close something that is already gone', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { unmount } = render(<Closer onClose={onClose} />);
    act(() => screen.getByText('close').click());
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes with the latest handler, not the one it was first given', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Closer onClose={first} />);
    act(() => screen.getByText('close').click());
    rerender(<Closer onClose={second} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

function Dialog({ onEscape, label }: { onEscape: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(ref, onEscape);
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label={label}>
      <button type="button">first {label}</button>
      <button type="button">last {label}</button>
    </div>
  );
}

describe('useOverlay', () => {
  // jsdom has no layout, so offsetParent is always null and nothing looks visible to the trap.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement;
    });
  });

  it('moves focus in, keeps Tab inside, and gives focus back and unlocks the page when it goes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Dialog onEscape={() => {}} label="a" />);

    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    screen.getByText('last a').focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    // Tab on the last control wraps, so focus is on the first rather than leaving.
    expect(screen.getByText('first a')).toHaveFocus();

    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('gives focus to the dialog it was opened over when what opened it is gone', () => {
    // The handlers are stable, as they have to be: a dialog whose handler changes takes focus again.
    const stay = () => {};
    function Over() {
      const [asked, setAsked] = useState(false);
      const [gone, setGone] = useState(false);
      const close = useCallback(() => setAsked(false), []);
      return (
        <>
          <Dialog onEscape={stay} label="under" />
          {!gone && (
            <button type="button" onClick={() => setAsked(true)}>
              ask
            </button>
          )}
          {asked && <Dialog onEscape={close} label="over" />}
          <button type="button" onClick={() => setGone(true)}>
            remove the button that asked
          </button>
        </>
      );
    }
    render(<Over />);
    const ask = screen.getByText('ask');
    ask.focus();
    act(() => ask.click());
    expect(screen.getByRole('dialog', { name: 'over' })).toHaveFocus();
    // What asked is removed while the answer is still open, and then the answer closes.
    act(() => screen.getByText('remove the button that asked').click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByRole('dialog', { name: 'over' })).toBeNull();
    // Focus is in the dialog that is still open, not on the page behind it.
    expect(screen.getByRole('dialog', { name: 'under' })).toHaveFocus();
  });

  it('shows a field that takes focus whole when it is half under the fold of a dialog that scrolls, with room for its ring', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    function Scrolling() {
      const ref = useRef<HTMLDivElement>(null);
      useOverlay(ref, () => {});
      return (
        <div ref={ref} tabIndex={-1} role="dialog" aria-label="scrolls">
          <div data-testid="body" style={{ overflowY: 'auto' }}>
            <textarea aria-label="description" />
            <textarea aria-label="visible" />
          </div>
        </div>
      );
    }
    render(<Scrolling />);
    const body = screen.getByTestId('body');
    // jsdom lays nothing out: the box has more to scroll than it shows, and these are where the fields are.
    Object.defineProperty(body, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 400, configurable: true });
    body.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, width: 300, height: 400, x: 0, y: 100, toJSON: () => ({}) });
    const place = (el: HTMLElement, top: number, bottom: number) => {
      el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
    };
    const half = screen.getByLabelText('description');
    place(half, 460, 560);
    act(() => half.focus());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));

    // A field whole in the room, but with its ring touching the edge, is shown with room too; one well inside is left alone.
    scrollIntoView.mockClear();
    const inside = screen.getByLabelText('visible');
    place(inside, 200, 300);
    act(() => inside.focus());
    expect(scrollIntoView).not.toHaveBeenCalled();
    place(inside, 200, 497);
    act(() => half.focus());
    act(() => inside.focus());
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('answers Escape in the topmost dialog only', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    function Stack() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Dialog onEscape={lower} label="lower" />
          <button type="button" onClick={() => setOpen(true)}>
            open upper
          </button>
          {open && <Dialog onEscape={upper} label="upper" />}
        </>
      );
    }
    render(<Stack />);
    act(() => screen.getByText('open upper').click());

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });
});

describe('ContextTabs', () => {
  const tabs = [
    { key: 'a', label: 'Alpha' },
    { key: 'b', label: 'Beta' },
  ];

  function rects(list: DOMRect, tab: DOMRect) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tablist' ? list : this.getAttribute('aria-selected') === 'true' ? tab : box(0, 0);
    });
  }

  it('measures the active tab from the inline-start edge, left to right', () => {
    document.documentElement.dir = 'ltr';
    rects(box(0, 300), box(100, 100));
    render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);
    const list = screen.getByRole('tablist');
    expect(list.style.getPropertyValue('--tab-x')).toBe('100px');
    expect(list.style.getPropertyValue('--tab-w')).toBe('100px');
    expect(list.dataset.ready).toBe('true');
  });

  it('measures the same tab from the right edge when the page reads right to left', () => {
    document.documentElement.dir = 'rtl';
    // In RTL the bar starts at its right edge, so the active tab sits 100px to the left of it.
    rects(box(0, 300), box(100, 100));
    render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);
    const list = screen.getByRole('tablist');
    expect(list.style.getPropertyValue('--tab-x')).toBe('-100px');
    expect(list.style.getPropertyValue('--tab-w')).toBe('100px');
  });

  it('measures again when a tab changes size, and stops when it is gone', () => {
    const sizes: { callback: ResizeObserverCallback; disconnected: boolean }[] = [];
    class FakeResize {
      constructor(callback: ResizeObserverCallback) {
        sizes.push({ callback, disconnected: false });
        this.index = sizes.length - 1;
      }
      index: number;
      observe() {}
      unobserve() {}
      disconnect() {
        sizes[this.index]!.disconnected = true;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResize);
    document.documentElement.dir = 'ltr';
    rects(box(0, 300), box(100, 100));
    const { unmount } = render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);
    const list = screen.getByRole('tablist');
    expect(list.style.getPropertyValue('--tab-w')).toBe('100px');

    // The webfont arrives and the tab gets wider.
    rects(box(0, 300), box(100, 130));
    act(() => sizes[0]!.callback([], {} as ResizeObserver));
    expect(list.style.getPropertyValue('--tab-w')).toBe('130px');

    unmount();
    expect(sizes[0]!.disconnected).toBe(true);
  });

  it('moves between tabs with the arrow that points the way it is read', () => {
    const picked: string[] = [];
    document.documentElement.dir = 'rtl';
    render(<ContextTabs label="t" tabs={tabs} active="a" onSelect={(k) => picked.push(k)} />);
    const list = screen.getByRole('tablist');
    // In right-to-left, the next tab is to the left.
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(picked).toEqual(['b']);
  });

  it('takes focus to the tab it selects, so the ring is on what is selected', () => {
    document.documentElement.dir = 'ltr';
    render(<ContextTabs label="t" tabs={tabs} active="a" onSelect={() => {}} />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();

    screen.getByRole('tablist').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }));
  });

  describe('on a phone, where the strip scrolls sideways', () => {
    afterEach(() => {
      // @ts-expect-error — the test put it there
      delete Element.prototype.scrollTo;
    });

    it('brings a selected tab that is out of sight into view, with room beside it', () => {
      document.documentElement.dir = 'ltr';
      const scrollTo = vi.fn();
      Element.prototype.scrollTo = scrollTo;
      // The strip shows 0 to 300; the selected tab is at 400 to 480, past its end.
      rects(box(0, 300), box(400, 80));

      render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 400 + 80 + 16 - 300 }));
    });

    it('brings it back from the other side too', () => {
      document.documentElement.dir = 'rtl';
      const scrollTo = vi.fn();
      Element.prototype.scrollTo = scrollTo;
      // In right-to-left the strip starts at its right end; the tab is out past its left end, at -120 to -40.
      rects(box(0, 300), box(-120, 80));

      render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);

      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: -120 - 16 }));
    });

    it('leaves a selected tab that is already in view where it is', () => {
      document.documentElement.dir = 'ltr';
      const scrollTo = vi.fn();
      Element.prototype.scrollTo = scrollTo;
      rects(box(0, 300), box(100, 80));

      render(<ContextTabs label="t" tabs={tabs} active="b" onSelect={() => {}} />);

      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});

function Harness({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLandingMotion(ref);
  return (
    <div ref={ref} className="lp" data-testid="root">
      <span className="lp-progress" data-testid="progress" />
      <section className="lp-hero" data-testid="hero">
        <div className="lp-fan" />
      </section>
      <div data-reveal data-testid="reveal">
        reveal me
      </div>
      {children}
    </div>
  );
}

describe('the landing page motion hook', () => {
  it('hides nothing where there is no IntersectionObserver to bring it back', () => {
    render(<Harness />);
    expect(screen.getByTestId('root')).not.toHaveClass('lp-js');
  });

  it('marks the page as ready for entrance motion where it can bring it back', () => {
    installObserver();
    render(<Harness />);
    expect(screen.getByTestId('root')).toHaveClass('lp-js');
  });

  it('reveals what scrolls into view, once', () => {
    installObserver();
    render(<Harness />);
    const reveal = screen.getByTestId('reveal');
    expect(reveal).not.toHaveClass('is-visible');
    const revealObserver = observers.find((o) => o.elements.includes(reveal))!;
    act(() => revealObserver.fire());
    expect(reveal).toHaveClass('is-visible');
  });

  it('tells the hero when it has scrolled away, so its idle motion can stop', () => {
    installObserver();
    render(<Harness />);
    const hero = screen.getByTestId('hero');
    const watcher = observers.find((o) => o.elements.includes(hero))!;
    act(() => watcher.fire(false));
    expect(hero).toHaveClass('is-offscreen');
    act(() => watcher.fire(true));
    expect(hero).not.toHaveClass('is-offscreen');
  });

  it('writes how far down the page is to the progress line, not to the page root', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    render(<Harness />);
    const root = screen.getByTestId('root');
    const progress = screen.getByTestId('progress');

    act(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(32);
    });
    expect(progress.style.getPropertyValue('--sp')).toBe('0.5');
    expect(root.style.getPropertyValue('--sp')).toBe('');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});

describe('useMotionReady', () => {
  function Target() {
    const ref = useRef<HTMLDivElement>(null);
    useMotionReady(ref);
    return <div ref={ref} data-testid="target" />;
  }

  it('needs IntersectionObserver, and says so by not adding the class without it', () => {
    render(<Target />);
    expect(screen.getByTestId('target')).not.toHaveClass('lp-js');
  });

  it('adds the class where it exists', () => {
    installObserver();
    render(<Target />);
    expect(screen.getByTestId('target')).toHaveClass('lp-js');
  });
});
