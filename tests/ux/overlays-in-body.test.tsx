import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: vi.fn(() => Promise.resolve([])), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const { DetailDrawer, ConfirmationModal } = await import('../../apps/web/src/shared/ui/DetailDrawer');
const { CardPhotoThumb } = await import('../../apps/web/src/shared/CardPhoto');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

/**
 * A fixed element is in the window only while nothing above it has a transform: a card that lifts when
 * it is pointed at, a drawer that has slid in. Overlays are asked for from inside things like that, so
 * they are drawn into the body, and these tests ask from inside one.
 */
function InsideATransform({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="lifted" style={{ transform: 'translateY(-8px)' }}>
      {children}
    </div>
  );
}

describe('overlays are drawn into the body, whatever they were asked from', () => {
  it('a drawer', () => {
    render(
      <I18nProvider>
        <InsideATransform>
          <DetailDrawer title="Item" onClose={() => {}}>
            <p>inside</p>
          </DetailDrawer>
        </InsideATransform>
      </I18nProvider>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[data-testid="lifted"]')).toBeNull();
    expect(dialog.parentElement).toBe(document.body);
  });

  it('a confirmation', () => {
    render(
      <I18nProvider>
        <InsideATransform>
          <ConfirmationModal
            title="Sure?"
            body="This cannot be undone."
            confirmLabel="Yes"
            cancelLabel="No"
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        </InsideATransform>
      </I18nProvider>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[data-testid="lifted"]')).toBeNull();
    expect(dialog.closest('.modal-backdrop')?.parentElement).toBe(document.body);
  });

  it('the photograph, which is a room with the card large and its name and serial on a plate', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <InsideATransform>
          <CardPhotoThumb serialNumber="SN-DX107-0003" title="2005 Pokémon EX Deoxys — Rayquaza" />
        </InsideATransform>
      </I18nProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Show photo of/ }));

    const dialog = screen.getByRole('dialog', { name: '2005 Pokémon EX Deoxys — Rayquaza' });
    expect(dialog.closest('[data-testid="lifted"]')).toBeNull();
    const room = dialog.closest('.lightbox');
    expect(room?.parentElement).toBe(document.body);

    // The name is its own island, so a Hebrew page does not read "… Rayquaza 2005".
    const name = within(dialog).getByRole('heading', { level: 4 });
    expect(name.querySelector('bdi')).toHaveAttribute('dir', 'auto');
    // The serial is a code, left to right.
    expect(within(dialog).getByText('SN-DX107-0003').closest('code')).toHaveAttribute('dir', 'ltr');
  });

  it('the photograph closes from its button and from the room around it, and Escape', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <CardPhotoThumb serialNumber="SN-DX107-0003" title="A card" />
      </I18nProvider>,
    );

    for (const close of [
      async () => user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })),
      async () => user.keyboard('{Escape}'),
    ]) {
      await user.click(screen.getByRole('button', { name: /Show photo of/ }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await close();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  });
});
