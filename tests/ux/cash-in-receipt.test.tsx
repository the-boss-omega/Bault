import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { WalletRequestForm } =
  await import('../../apps/web/src/areas/customer/finance/WalletRequestForms');
const { WalletPage } = await import('../../apps/web/src/areas/customer/finance/WalletPage');
const { WalletRequestsSection } =
  await import('../../apps/web/src/areas/admin/WalletRequestsSection');

const renderIn = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

const RECEIPT_KEY = 'receipts/u-1/2026/11/0f0e.pdf';
const pdf = () => new File(['%PDF-1.4 transfer'], 'transfer.pdf', { type: 'application/pdf' });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  window.location.hash = '';
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:preview', writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });
  }
});

describe('the cash-in form', () => {
  it('takes an optional receipt, uploaded as a cash-in receipt, and sends its key with the request', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(null);
    post.mockImplementation(async (path: string) =>
      path === '/media/uploads' ? { objectKey: RECEIPT_KEY } : { code: 'WR-NEW00001' },
    );
    const onSubmitted = vi.fn();
    renderIn(
      <WalletRequestForm type="cash_in" availableMinor={0} existingRequests={[]} onSubmitted={onSubmitted} />,
    );
    expect(screen.getByText('Receipt (optional)')).toBeInTheDocument();
    const input = screen.getByLabelText('Attach a receipt', { selector: 'input' }) as HTMLInputElement;
    expect(input.accept).toContain('application/pdf');
    expect(input.multiple).toBe(false);
    expect(input.hasAttribute('capture')).toBe(false);

    await user.upload(input, pdf());
    expect(await screen.findByText('transfer.pdf')).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      '/media/uploads',
      expect.objectContaining({ purpose: 'cash_in_receipt', contentType: 'application/pdf' }),
    );
    expect(screen.queryByRole('button', { name: 'Attach a receipt' })).toBeNull();

    await user.type(screen.getByLabelText('Amount'), '50');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/finance/wallet-requests',
        expect.objectContaining({ type: 'cash_in', documentKey: RECEIPT_KEY }),
      ),
    );
    expect(onSubmitted).toHaveBeenCalled();
    expect(screen.queryByText('transfer.pdf')).toBeNull();
  });

  it('sends no key when no receipt was chosen', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(null);
    post.mockResolvedValue({ code: 'WR-NEW00002' });
    renderIn(<WalletRequestForm type="cash_in" availableMinor={0} existingRequests={[]} onSubmitted={() => {}} />);
    await user.type(screen.getByLabelText('Amount'), '50');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).not.toHaveProperty('documentKey');
  });

  it('asks a cash-out for no receipt', () => {
    get.mockResolvedValue(null);
    renderIn(<WalletRequestForm type="cash_out" availableMinor={100_000} existingRequests={[]} onSubmitted={() => {}} />);
    expect(screen.queryByText('Receipt (optional)')).toBeNull();
  });
});

const request = (over: Record<string, unknown>) => ({
  id: 'wr-1',
  code: 'WR-RCPT0001',
  type: 'cash_in',
  status: 'submitted',
  amount: 25_000,
  currency: 'USD',
  fundingSource: 'bank_transfer',
  destinationAccount: null,
  beneficiaryName: null,
  reference: null,
  notes: null,
  receiptAttached: false,
  rejectionReason: null,
  completedAt: null,
  createdAt: '2026-11-20T12:00:00.000Z',
  updatedAt: '2026-11-20T12:00:00.000Z',
  history: [],
  ...over,
});

function walletApi(detail: Record<string, unknown>) {
  return async (path: string) => {
    if (path === '/finance/wallet') return { amount: 0, currency: 'USD' };
    if (path === '/finance/wallet/pending') return { cashInMinor: 0, cashOutMinor: 0, count: 0 };
    if (path === '/finance/wallet-requests') return [detail];
    if (path === `/finance/wallet-requests/${detail.id}`) return detail;
    if (path === `/finance/wallet-requests/${detail.id}/receipt`)
      return { url: 'https://store.test/receipt?X-Amz-Expires=300', contentType: 'application/pdf', expiresInSeconds: 300 };
    return null;
  };
}

describe('a cash-in request, opened by its owner', () => {
  it('says a receipt is attached, opens it by a signed link, and lets it be replaced while it waits', async () => {
    const user = userEvent.setup();
    let current = request({ receiptAttached: true });
    get.mockImplementation((path: string) => walletApi(current)(path));
    post.mockResolvedValue({ objectKey: RECEIPT_KEY });
    put.mockImplementation(async () => {
      current = { ...current, updatedAt: '2026-11-21T12:00:00.000Z' };
      return current;
    });
    window.location.hash = '#/wallet/requests?request=wr-1';
    renderIn(<WalletPage />);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Receipt attached')).toBeInTheDocument();

    const link = await within(drawer).findByRole('link', { name: /Open receipt/ });
    expect(link).toHaveAttribute('href', 'https://store.test/receipt?X-Amz-Expires=300');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(get).toHaveBeenCalledWith('/finance/wallet-requests/wr-1/receipt');

    const input = within(drawer).getByLabelText('Replace receipt', { selector: 'input' });
    await user.upload(input, pdf());
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/finance/wallet-requests/wr-1/receipt', { documentKey: RECEIPT_KEY }),
    );
    expect(post).toHaveBeenCalledWith('/media/uploads', expect.objectContaining({ purpose: 'cash_in_receipt' }));
    expect(await within(drawer).findByText('The receipt was saved.')).toBeInTheDocument();
  });

  it('offers to attach one while it waits, where there is none', async () => {
    get.mockImplementation(walletApi(request({ status: 'pending_review' })));
    window.location.hash = '#/wallet/requests?request=wr-1';
    renderIn(<WalletPage />);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('No receipt')).toBeInTheDocument();
    expect(within(drawer).getByLabelText('Attach a receipt', { selector: 'input' })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith('/finance/wallet-requests/wr-1/receipt');
  });

  it('keeps the receipt but offers no replacement once the request is decided', async () => {
    get.mockImplementation(walletApi(request({ status: 'completed', receiptAttached: true })));
    window.location.hash = '#/wallet/requests?request=wr-1';
    renderIn(<WalletPage />);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Receipt attached')).toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Replace receipt', { selector: 'input' })).toBeNull();
  });

  it('says nothing of a receipt on a cash-out', async () => {
    get.mockImplementation(
      walletApi(request({ type: 'cash_out', fundingSource: null, destinationAccount: 'GB29NWBK60161331926819' })),
    );
    window.location.hash = '#/wallet/requests?request=wr-1';
    renderIn(<WalletPage />);
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('GB29NWBK60161331926819');
    expect(within(drawer).queryByText('No receipt')).toBeNull();
    expect(within(drawer).queryByText('Receipt attached')).toBeNull();
  });
});

describe('a cash-in request on the desk', () => {
  it('links the receipt by its signed address and says how long the link lasts', async () => {
    const staffRow = {
      ...request({ status: 'pending_review' }),
      userId: 'u-1',
      documentKey: RECEIPT_KEY,
      settledLedgerId: null,
      payoutReference: null,
      reviewedBy: null,
      reviewedAt: null,
      username: 'red',
      customerName: 'Red Ashwood',
      email: 'red@example.com',
    };
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/wallet-requests?')) return [staffRow];
      if (path === '/admin/wallet-requests/wr-1')
        return {
          ...staffRow,
          history: [],
          receipt: { url: 'https://store.test/staff?X-Amz-Expires=300', contentType: 'application/pdf', expiresInSeconds: 300 },
        };
      return [];
    });
    window.location.hash = '#/admin/requests?request=wr-1';
    renderIn(<WalletRequestsSection currentUserId="me" onMsg={() => {}} onError={() => {}} />);
    const drawer = await screen.findByRole('dialog', { name: 'WR-RCPT0001' });
    const link = await within(drawer).findByRole('link', { name: /Open receipt/ });
    expect(link).toHaveAttribute('href', 'https://store.test/staff?X-Amz-Expires=300');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(drawer).getByText(/5 minutes/)).toBeInTheDocument();
    expect(within(drawer).queryByText(RECEIPT_KEY)).toBeNull();
  });
});
