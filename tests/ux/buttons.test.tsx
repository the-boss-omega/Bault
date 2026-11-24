import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { Button, ButtonLink, IconButton } = await import('../../apps/web/src/shared/ui/primitives');

/**
 * The button family as components: what each variant is called, what a working button, a switch and a
 * link drawn as a button say to a screen reader. How they look is measured in a browser
 * (buttons-in-a-browser.test.tsx).
 */

const SRC = join(__dirname, '..', '..', 'apps', 'web', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });

describe('Button', () => {
  it('is a secondary button that does not submit, until it is told otherwise', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('btn', 'btn--secondary');
    expect(button).not.toHaveClass('btn--sm', 'btn--block', 'btn--loading');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('takes the variant, size and width a screen asks for', () => {
    render(
      <>
        <Button variant="primary" size="sm" block>
          Pay
        </Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Withdraw</Button>
        <Button variant="link">Read the terms</Button>
        <Button type="submit">Send</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Pay' })).toHaveClass(
      'btn--primary',
      'btn--sm',
      'btn--block',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn--ghost');
    expect(screen.getByRole('button', { name: 'Withdraw' })).toHaveClass('btn--danger');
    expect(screen.getByRole('button', { name: 'Read the terms' })).toHaveClass('btn--link');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });

  it('keeps its name while it works, and says it is busy', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading onClick={onClick}>
        Pay now
      </Button>,
    );
    // The spinner is not part of the name; the button is still "Pay now", and it is working.
    const button = screen.getByRole('button', { name: 'Pay now' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('btn--loading');
    expect(button.querySelector('.btn-spinner')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows its icon in front of its label, and the spinner in the icon's place", () => {
    const { rerender } = render(<Button icon={<svg data-testid="glyph" />}>Download</Button>);
    const button = screen.getByRole('button', { name: 'Download' });
    expect(button.firstElementChild).toBe(screen.getByTestId('glyph'));
    rerender(
      <Button icon={<svg data-testid="glyph" />} loading>
        Download
      </Button>,
    );
    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download' }).firstElementChild).toHaveClass(
      'btn-spinner',
    );
  });

  it('is a switch when it is given a state to be in, and only then', () => {
    const { rerender } = render(<Button>Filter</Button>);
    expect(screen.getByRole('button', { name: 'Filter' })).not.toHaveAttribute('aria-pressed');
    rerender(<Button pressed>Filter</Button>);
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<Button pressed={false}>Filter</Button>);
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('has no gold and no navy left, in a component or a stylesheet: the names are for what a button is for', () => {
    const left = files(SRC)
      .filter((file) => /\.(?:tsx?|css)$/.test(file))
      .filter((file) =>
        /btn--(?:gold|navy)|variant="(?:gold|navy)"/.test(readFileSync(file, 'utf8')),
      );
    expect(left).toEqual([]);
  });
});

describe('ButtonLink', () => {
  it('is a link that is drawn as a button, and goes where it says', () => {
    render(
      <ButtonLink
        variant="primary"
        size="sm"
        href="/files/ledger.csv"
        download
        icon={<svg data-testid="glyph" />}
      >
        Download the ledger
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Download the ledger' });
    expect(link).toHaveAttribute('href', '/files/ledger.csv');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveClass('btn', 'btn--primary', 'btn--sm');
    expect(link.firstElementChild).toBe(screen.getByTestId('glyph'));
  });
});

describe('IconButton', () => {
  it('is named for what it does, in its label and its tooltip', () => {
    render(
      <IconButton label="Notifications">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Notifications' });
    expect(button).toHaveClass('icon-btn');
    expect(button).toHaveAttribute('title', 'Notifications');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('can be bare, and can be a switch', () => {
    render(
      <>
        <IconButton label="Theme" bare pressed>
          <svg />
        </IconButton>
        <IconButton label="Menu">
          <svg />
        </IconButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveClass('icon-btn--bare');
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Menu' })).not.toHaveAttribute('aria-pressed');
  });
});
