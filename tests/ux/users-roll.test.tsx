import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const patch = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: (...a: unknown[]) => patch(...a),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');

const account = (
  id: string,
  username: string,
  first: string | null,
  last: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  email: `${username}@bault.dev`,
  username,
  firstName: first,
  lastName: last,
  nameReviewRequired: false,
  role: 'user',
  status: 'active',
  autoSuspended: false,
  intakeId: null,
  mfaEnabled: false,
  ...extra,
});

const USERS = [
  account('u1', 'dana', 'Dana', 'Okonkwo', { status: 'suspended', autoSuspended: true }),
  account('u2', 'eldar', 'Eldar', 'Cohen', { role: 'admin', mfaEnabled: true }),
  account('u3', 'veteran', 'Ana Maria van der Berg', null, {
    nameReviewRequired: true,
    intakeId: 'OW-DCCGQN',
  }),
  account('u4', 'ghost', null, null, { role: 'warehouse_operator' }),
];

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) => (path === '/admin/users' ? USERS : []));
  window.location.hash = '#/admin/users';
});

function users() {
  return render(
    <I18nProvider>
      <AdminConsole currentUserId="u2" />
    </I18nProvider>,
  );
}

const rows = () => Array.from(document.querySelectorAll('.data-table tbody tr')) as HTMLElement[];

describe('the accounts, a roll', () => {
  it('has a line to each account: their initials, their name, their username and email, what they may do, and where the account stands', async () => {
    users();
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    expect(rows()).toHaveLength(4);

    const [dana, eldar, , ghost] = rows() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(dana.querySelector('.avatar')).toHaveTextContent('DO');
    expect(dana).toHaveTextContent('@dana · dana@bault.dev');
    expect(dana).toHaveTextContent('Collector');
    expect(within(dana).getByText('Suspended')).toBeInTheDocument();
    expect(within(dana).queryByText('2FA')).toBeNull();

    expect(eldar).toHaveTextContent('Manager');
    expect(within(eldar).getByText('2FA')).toBeInTheDocument();

    // An account with no name is read by its email, and is still one you can open.
    expect(within(ghost).getByRole('button', { name: 'ghost@bault.dev' })).toBeInTheDocument();
    expect(ghost).toHaveTextContent('Warehouse operator');
  });

  it('says what needs another look: a name carried over from the old system', async () => {
    users();
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    expect(rows()[2]).toHaveTextContent('Migrated legacy name — needs review.');
    expect(rows()[0]).not.toHaveTextContent('needs review');
  });

  it('keeps no field of an account in its line: it is changed in its drawer', async () => {
    users();
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    expect(document.querySelectorAll('.data-table input, .data-table select')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the account figures, the usernames and emails, read left to right', async () => {
    users();
    await screen.findByRole('button', { name: 'Dana Okonkwo' });
    for (const row of rows()) {
      // The username is a code, and the email is read as the characters it is.
      expect(row.querySelector('.dt-sub .code-inline[dir="ltr"]')).not.toBeNull();
      expect(row.querySelector('.dt-sub span[dir="ltr"]')).not.toBeNull();
    }
  });
});

describe('an account, opened', () => {
  it('is opened by its name, or by anywhere in its line, and is a link that can be sent', async () => {
    const user = userEvent.setup();
    users();
    await user.click(await screen.findByRole('button', { name: 'Eldar Cohen' }));
    expect(window.location.hash).toBe('#/admin/users?user=u2');
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Eldar Cohen' })).toBeInTheDocument();
  });

  it('shows the account as a card that follows the name, the role and the status as they are chosen', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u1';
    users();
    const drawer = await screen.findByRole('dialog');
    const card = within(drawer).getByRole('region', { name: 'Account' });
    expect(card.querySelector('.drawer-tag-title')).toHaveTextContent('Dana Okonkwo');
    expect(within(card).getByText('Email').nextElementSibling).toHaveTextContent('dana@bault.dev');
    expect(within(card).getByText('Username').nextElementSibling).toHaveTextContent('@dana');
    expect(within(card).getByText('Suspended')).toBeInTheDocument();

    const first = within(drawer).getByRole('textbox', { name: 'First name' });
    await user.clear(first);
    await user.type(first, 'Danielle');
    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Role' }), 'admin');
    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Status' }), 'active');

    expect(card.querySelector('.drawer-tag-title')).toHaveTextContent('Danielle Okonkwo');
    expect(within(card).getByText('Manager')).toBeInTheDocument();
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).queryByText('Suspended')).toBeNull();
  });

  it('carries the old intake number under the email, as a note on it', async () => {
    window.location.hash = '#/admin/users?user=u3';
    users();
    const card = within(await screen.findByRole('dialog')).getByRole('region', { name: 'Account' });
    expect(within(card).getByText('OW-DCCGQN')).toHaveAttribute(
      'title',
      expect.stringMatching(/historical intake id/i),
    );
  });

  it('says, where there is no name, that there is none, and names the account by its email', async () => {
    window.location.hash = '#/admin/users?user=u4';
    users();
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'ghost@bault.dev' })).toBeInTheDocument();
    const card = within(drawer).getByRole('region', { name: 'Account' });
    expect(card.querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent(
      'ghost@bault.dev',
    );
  });

  it('puts the account that was saved into the roll at once, and is not changed again until something is', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u1';
    patch.mockResolvedValue({ ...USERS[0], firstName: 'Danielle', autoSuspended: false });
    users();
    const drawer = await screen.findByRole('dialog');
    const first = within(drawer).getByRole('textbox', { name: 'First name' });
    await user.clear(first);
    await user.type(first, 'Danielle');
    const save = within(drawer).getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/admin/users/u1', { firstName: 'Danielle' }),
    );
    expect(await screen.findByRole('button', { name: 'Danielle Okonkwo' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }),
      ).toBeDisabled(),
    );
  });

  it('tells what a save came to inside the drawer, where it is seen, as well as on the page behind it', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u1';
    patch.mockRejectedValueOnce(new Error('You cannot suspend or close your own account here.'));
    users();
    const drawer = await screen.findByRole('dialog');
    await user.selectOptions(within(drawer).getByRole('combobox', { name: 'Role' }), 'admin');
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    // In the drawer's own footer, in the dialog, so a screen reader reads it out and a phone shows it.
    const alert = await within(drawer).findByRole('alert');
    expect(alert).toHaveTextContent('You cannot suspend or close your own account here.');
    expect(drawer.querySelector('.drawer-foot')).toContainElement(alert);

    patch.mockResolvedValueOnce({ ...USERS[0], role: 'admin' });
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    const saved = await within(drawer).findByRole('status');
    expect(saved).toHaveTextContent('dana@bault.dev');
    // The refusal is no longer there: what the drawer says is the last thing done.
    expect(within(drawer).queryByRole('alert')).toBeNull();
  });

  it('does not count confirming a name as an edit: nothing was typed, so the backdrop still shuts it', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u3';
    users();
    const drawer = await screen.findByRole('dialog');
    // Something is to be sent (the name, as it is, confirmed), so Save is on ...
    expect(within(drawer).getByRole('button', { name: 'Save' })).toBeEnabled();
    // ... but nothing was changed by hand, so a click beside the drawer is not a discarded edit.
    await user.click(document.querySelector('.drawer-backdrop') as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe('#/admin/users'));
  });

  it('does keep a drawer open, under a click beside it, once something has been typed in it', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u3';
    users();
    const drawer = await screen.findByRole('dialog');
    await user.type(within(drawer).getByRole('textbox', { name: 'First name' }), 'x');
    await user.click(document.querySelector('.drawer-backdrop') as HTMLElement);
    expect(window.location.hash).toBe('#/admin/users?user=u3');
  });

  it('is shut by its close button, and the link goes back to the roll', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/admin/users?user=u1';
    users();
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(window.location.hash).toBe('#/admin/users'));
  });
});
