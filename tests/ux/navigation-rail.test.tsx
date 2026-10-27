import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { NavigationRail } = await import('../../apps/web/src/shared/ui/NavigationRail');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const destinations = [
  { key: 'vault', label: 'Vault', icon: <span /> },
  { key: 'wallet', label: 'Wallet', icon: <span /> },
  { key: 'support', label: 'Support', icon: <span />, secondary: true },
];

/** A phone: the rail is a sheet that something else opens. */
function Phone({ open, onRequestClose = () => {} }: { open: boolean; onRequestClose?: () => void }) {
  return (
    <I18nProvider>
      <button type="button">Open navigation menu</button>
      <NavigationRail
        destinations={destinations}
        active="wallet"
        onNavigate={() => {}}
        mobile
        open={open}
        onRequestClose={onRequestClose}
      />
    </I18nProvider>
  );
}

describe('the rail on a phone', () => {
  it('takes focus when it opens, on the page you are on, and gives it back to what opened it', () => {
    const { rerender } = render(<Phone open={false} />);
    const opener = screen.getByRole('button', { name: 'Open navigation menu' });
    opener.focus();

    rerender(<Phone open />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Wallet' }));
    expect(document.activeElement).toHaveAttribute('aria-current', 'page');

    rerender(<Phone open={false} />);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape, and only while it is open', async () => {
    const user = userEvent.setup();
    const onRequestClose = vi.fn();
    const { rerender } = render(<Phone open={false} onRequestClose={onRequestClose} />);

    await user.keyboard('{Escape}');
    expect(onRequestClose).not.toHaveBeenCalled();

    rerender(<Phone open onRequestClose={onRequestClose} />);
    await user.keyboard('{Escape}');
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('is not moved by anything on a desktop, where it opens on hover and focus by itself', () => {
    render(
      <I18nProvider>
        <button type="button">Elsewhere</button>
        <NavigationRail
          destinations={destinations}
          active="wallet"
          onNavigate={() => {}}
          mobile={false}
          open={false}
          onRequestClose={() => {}}
        />
      </I18nProvider>,
    );

    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });
});

describe('the closed sheet, in the stylesheet', () => {
  // jsdom does not lay a page out, so what keeps a closed rail out of the tab order is read from the CSS:
  // off screen by a transform alone, its nine items would still be reachable from the keyboard.
  const css = readFileSync(join(__dirname, '..', '..', 'apps', 'web', 'src', 'index.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 767px) {\n  /* The rail'));

  function rule(selector: string): string {
    const at = phone.indexOf(`\n  ${selector} {`);
    return phone.slice(at, phone.indexOf('}', at));
  }

  it('is hidden while closed, after it has slid out', () => {
    const closed = rule('.rail');
    expect(closed).toMatch(/visibility:\s*hidden/);
    expect(closed).toMatch(/visibility 0s linear var\(--dur-lg\)/);
  });

  it('is visible the moment it opens', () => {
    const open = rule('.rail.is-open');
    expect(open).toMatch(/visibility:\s*visible/);
    expect(open).toMatch(/visibility 0s(?!\s+linear)/);
  });
});
