import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { SupportPage } = await import('../../apps/web/src/areas/customer/support/SupportPage');

// Midday in UTC, so that a day is the same day wherever the test runs.
const ticket = (id: string, code: string, subject: string, status: string, category: string, lastMessageAt: string) => ({
  id,
  code,
  subject,
  status,
  category,
  relatedType: null,
  relatedId: null,
  lastMessageAt,
  createdAt: lastMessageAt,
});

const TICKETS = [
  ticket('t1', 'TKT-AAAA1111', 'Rayquaza-EX arrived as Raw', 'awaiting_customer', 'item', '2026-10-27T12:00:00.000Z'),
  ticket('t2', 'TKT-BBBB2222', 'Where is my parcel', 'open', 'parcel', '2026-10-27T09:00:00.000Z'),
  ticket('t3', 'TKT-CCCC3333', 'A charge I do not know', 'resolved', 'billing', '2026-10-25T12:00:00.000Z'),
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) => {
    if (path === '/support/tickets') return TICKETS;
    const one = TICKETS.find((x) => path === `/support/tickets/${x.id}`);
    if (one) return { ticket: one, messages: [] };
    return [];
  });
  post.mockResolvedValue({ code: 'TKT-NEW00001' });
});

async function support(hash: string) {
  window.location.hash = hash;
  const view = render(
    <I18nProvider>
      <SupportPage />
    </I18nProvider>,
  );
  await act(async () => {});
  return view;
}

describe('the tickets, a register in days', () => {
  it('writes each ticket as an entry: when, whose turn it is, what it is about, and its number', async () => {
    await support('#/support');
    const days = await screen.findAllByRole('heading', { level: 3 });
    // Two days, the nearer one first.
    expect(days).toHaveLength(2);
    const [today, earlier] = days.map((h) => document.getElementById(h.id)!.closest('.register-day-group')!) as HTMLElement[];

    const first = within(today).getAllByRole('listitem');
    expect(first).toHaveLength(2);
    // Newest first, whatever order the API gave them in.
    expect(first[0]).toHaveTextContent('Rayquaza-EX arrived as Raw');
    expect(first[0]).toHaveTextContent('Waiting for you');
    expect(first[0]).toHaveTextContent('TKT-AAAA1111 · An item in my vault');
    expect(first[0].querySelector('.hint.date')).toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(first[1]).toHaveTextContent('Where is my parcel');
    expect(first[1]).toHaveTextContent('Waiting for us');

    const second = within(earlier).getAllByRole('listitem');
    expect(second).toHaveLength(1);
    expect(second[0]).toHaveTextContent('Resolved');
    expect(second[0]).toHaveTextContent('Billing and wallet');
  });

  it('keeps each number as a code read left to right', async () => {
    await support('#/support');
    const codes = (await screen.findAllByText(/^TKT-/)).filter((el) => el.classList.contains('code-inline'));
    expect(codes).toHaveLength(3);
    for (const code of codes) expect(code).toHaveAttribute('dir', 'ltr');
  });

  it('opens a ticket from its subject, and its conversation is read by that number', async () => {
    const user = userEvent.setup();
    await support('#/support');
    await user.click(await screen.findByRole('button', { name: 'Where is my parcel' }));
    expect(window.location.hash).toContain('ticket=t2');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/support/tickets/t2'));
  });

  it('is the tickets and nothing else when there are none', async () => {
    get.mockImplementation(async () => []);
    await support('#/support');
    expect(await screen.findByText('No tickets yet')).toBeInTheDocument();
    expect(document.querySelector('.register-day')).toBeNull();
  });
});

describe('a new ticket, written on a stub as it is composed', () => {
  const stub = () => within(document.querySelector('.drawer-tag') as HTMLElement);

  it('has the ticket, empty, before anything is written: what it will say is asked for, not made up', async () => {
    await support('#/support/new');
    await screen.findByRole('textbox', { name: 'Subject' });
    const slip = document.querySelector('.drawer-tag') as HTMLElement;
    // The subject has not been written: the slip names the field, quietly, and does not pretend.
    expect(slip.querySelector('.drawer-tag-title .drawer-tag-quiet')).toHaveTextContent('Subject');
    expect(slip.querySelector('.ticket-note p')).toHaveTextContent('—');
    // It will be filed in the first category and wait for us.
    expect(stub().getByText('Category').nextElementSibling).toHaveTextContent('Inbound parcel');
    expect(stub().getByText('Waiting for us')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send ticket' })).toBeDisabled();
  });

  it('follows the subject, the message and the kind as they are written', async () => {
    const user = userEvent.setup();
    await support('#/support/new');
    await user.type(await screen.findByRole('textbox', { name: 'Subject' }), 'Rayquaza arrived raw');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'The card is not the grade I paid for.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'item');

    const slip = document.querySelector('.drawer-tag') as HTMLElement;
    expect(slip.querySelector('.drawer-tag-title')).toHaveTextContent('Rayquaza arrived raw');
    expect(slip.querySelector('.drawer-tag-title .drawer-tag-quiet')).toBeNull();
    expect(slip.querySelector('.ticket-note p')).toHaveTextContent('The card is not the grade I paid for.');
    expect(stub().getByText('Category').nextElementSibling).toHaveTextContent('An item in my vault');
  });

  it('files what the stub shows, as typed and trimmed', async () => {
    const user = userEvent.setup();
    await support('#/support/new');
    await user.type(await screen.findByRole('textbox', { name: 'Subject' }), '  Rayquaza arrived raw ');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Not the grade I paid for.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'item');
    await user.click(screen.getByRole('button', { name: 'Send ticket' }));
    expect(post).toHaveBeenCalledWith('/support/tickets', {
      category: 'item',
      subject: 'Rayquaza arrived raw',
      body: 'Not the grade I paid for.',
    });
  });

  it('lets what is written take the direction of its own language', async () => {
    await support('#/support/new');
    const typed = [
      await screen.findByRole('textbox', { name: 'Subject' }),
      screen.getByRole('textbox', { name: 'Message' }),
    ];
    for (const field of typed) expect(field).toHaveAttribute('dir', 'auto');
  });
});
