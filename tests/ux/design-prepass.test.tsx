import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      readonly kind: string,
      readonly status: number,
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  },
  apiErrorKey: () => null,
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');
const { WalletPage } = await import('../../apps/web/src/areas/customer/finance/WalletPage');
const { VerifyEmailPage } = await import('../../apps/web/src/areas/customer/auth/VerifyEmailPage');
const { ResetPasswordPage } = await import('../../apps/web/src/areas/customer/auth/ResetPasswordPage');
const { ApiError } = await import('../../apps/web/src/shared/api');
const { PriceListPanel } = await import('../../apps/web/src/areas/customer/help/PriceListPanel');
const { IntakePolicyPanel } = await import('../../apps/web/src/areas/customer/help/IntakePolicyPanel');
const { AdminConsole } = await import('../../apps/web/src/areas/admin/AdminConsole');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const ITEM = {
  id: 'i1',
  serialNumber: 'SN-DR97-0001',
  barcode: 'SN-DR97-0001',
  typeClass: 'trading_card',
  description: 'Rayquaza ex #97/97',
  conditionGrade: 'PSA 9',
  lifecycleState: 'stored',
  binBarcode: 'BIN-BBBB2222',
  binZone: 'B',
  isLot: false,
  lotSize: 1,
  oversized: false,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.setItem('bault.locale', 'en');
  window.location.hash = '';
});

describe('an item is named by its serial and description, never by its class key', () => {
  it('lists cards to ship with the serial first and no trading_card', async () => {
    get.mockImplementation((path: string) => {
      if (path === '/shipping/services') {
        return Promise.resolve({ addOns: [], boxSizes: [], signatureRequiredAboveMinor: 50_000, maxInsuredMinor: 500_000 });
      }
      return Promise.resolve([]);
    });
    renderIn(<ShipmentComposer items={[ITEM]} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />);
    const label = await screen.findByRole('checkbox', { name: /Rayquaza ex #97\/97/ });
    expect(label.closest('label')!.textContent).toContain('SN-DR97-0001');
    // The cards are one group with a name, so a screen reader says what it has entered.
    expect(label.closest('fieldset')).toHaveAccessibleName('Select items to ship');
    expect(document.body.textContent).not.toContain('trading_card');
  });

  it('says what class a card is in words on its sheet', async () => {
    window.location.hash = '#/vault?item=i1';
    get.mockImplementation((path: string) => {
      if (path.endsWith('/timeline')) return Promise.resolve([]);
      if (path.endsWith('/storage')) return Promise.reject(new Error('no storage in this test'));
      if (path.startsWith('/vault/items/')) return Promise.resolve({ images: [], openRequests: [] });
      if (path.startsWith('/vault/items')) return Promise.resolve([ITEM]);
      return Promise.resolve({ active: 1, hold: 0, history: 0 });
    });
    renderIn(<VaultPage />);
    await waitFor(() => expect(screen.getAllByText('Trading card').length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toContain('trading_card');
  });
});

describe('the browser tab', () => {
  it('names the section you are in, and goes back to the brand when you leave', async () => {
    const { default: App } = await import('../../apps/web/src/App');
    const { t } = await import('../../apps/web/src/shared/i18n');
    const { ThemeProvider } = await import('../../apps/web/src/shared/theme');
    get.mockImplementation(async (path: string) => {
      if (path === '/me/profile') {
        return {
          id: 'me', role: 'user', status: 'active', email: 'red@bault.dev', username: 'red',
          firstName: 'Red', lastName: 'Ashwood', fullName: 'Red Ashwood', nameReviewRequired: false,
          mfaRequired: false, mfaEnabled: false,
        };
      }
      return [];
    });
    window.location.hash = '#/support';
    const { unmount } = render(
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(document.title).toBe(`${t('support.title', 'en')} · Bault`));
    unmount();
    expect(document.title).toBe('Bault');
  });
});

describe('every wallet movement says what it is in words', () => {
  const LEDGER_TYPES = [
    'purchase', 'sale_credit', 'fee', 'service_charge', 'credit_topup', 'withdrawal', 'interest',
    'escrow_hold', 'escrow_release', 'escrow_refund', 'chargeback', 'shipping_refund', 'service_refund',
    'payout_reversal',
  ];
  const REFERENCE_TYPES = [
    'charge', 'escrow_deal', 'external_payment', 'listing', 'service_request', 'shipment', 'transaction',
    'wallet_request', 'withdrawal',
  ];
  const rows = LEDGER_TYPES.map((type, i) => ({
    id: `r${i}`,
    type,
    amount: 100 + i,
    direction: i % 2 ? 'credit' : 'debit',
    currency: 'USD',
    referenceType: REFERENCE_TYPES[i % REFERENCE_TYPES.length]!,
    referenceId: `ref-${i}-0000`,
    occurredAt: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
  }));
  const extra = REFERENCE_TYPES.map((referenceType, i) => ({ ...rows[0]!, id: `x${i}`, referenceType }));

  function walletApi(path: string) {
    if (path === '/finance/wallet') return Promise.resolve({ amount: 7_500, currency: 'USD' });
    if (path === '/finance/ledger') return Promise.resolve([...rows, ...extra]);
    if (path === '/finance/wallet/pending') return Promise.resolve({ cashInMinor: 0, cashOutMinor: 0, count: 0 });
    return Promise.resolve([]);
  }

  for (const locale of ['en', 'he'] as const) {
    it(`labels each type and reference in ${locale}`, async () => {
      localStorage.setItem('bault.locale', locale);
      window.location.hash = '#/wallet/transactions';
      get.mockImplementation(walletApi);
      render(
        <I18nProvider>
          <WalletPage />
        </I18nProvider>,
      );
      const table = await screen.findByRole('table');
      await waitFor(() => expect(table.querySelectorAll('tbody tr').length).toBeGreaterThan(10));
      const text = table.textContent ?? '';
      for (const raw of [...LEDGER_TYPES, ...REFERENCE_TYPES].filter((key) => key.includes('_'))) {
        expect(text, raw).not.toContain(raw.replace(/_/g, ' '));
      }
      if (locale === 'he') expect(text).not.toMatch(/escrow|request|deal|shipment|chargeback/i);
    });
  }
});

describe('a link that no longer works says so in the page’s language', () => {
  it('on the verify page, in Hebrew', async () => {
    localStorage.setItem('bault.locale', 'he');
    post.mockRejectedValue(new ApiError('client', 410, 'Invalid verification link', 'TOKEN_EXPIRED'));
    renderIn(<VerifyEmailPage token="stale-token" />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/[֐-׿]/));
    expect(document.body.textContent).not.toContain('Invalid verification link');
  });

  it('on the reset page, in Hebrew', async () => {
    localStorage.setItem('bault.locale', 'he');
    post.mockRejectedValue(new ApiError('client', 410, 'Token is expired or already used', 'TOKEN_EXPIRED'));
    const { container } = renderIn(<ResetPasswordPage token="stale-token" />);
    const [password, confirm] = container.querySelectorAll('input[type="password"]');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(password!, { target: { value: 'a-new-password' } });
    fireEvent.change(confirm!, { target: { value: 'a-new-password' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/[֐-׿]/));
    expect(document.body.textContent).not.toContain('Token is expired');
  });
});

describe('the price list', () => {
  const LIST = {
    groups: [
      {
        group: 'intake',
        entries: [
          {
            actionType: 'intake', itemClass: 'small_collectible', description: 'Intake: A small collectible',
            model: 'fixed', value: 500, currency: 'USD', billingTrigger: 'per_event', parameters: null,
          },
        ],
      },
    ],
    note: 'The rule in force at the moment of a charge is recorded with that charge.',
  };

  it('in Hebrew, names the class in words and explains itself in Hebrew', async () => {
    localStorage.setItem('bault.locale', 'he');
    get.mockResolvedValue(LIST);
    renderIn(<PriceListPanel />);
    const row = await screen.findByText('Intake: A small collectible');
    expect(document.body.textContent).not.toContain('small_collectible');
    expect(document.body.textContent).not.toContain('The rule in force');
    expect(row.closest('.ltr-run, [dir="ltr"]')).not.toBeNull();
  });

  it('sets money in the UI face, not the code face', async () => {
    localStorage.setItem('bault.locale', 'en');
    get.mockResolvedValue(LIST);
    renderIn(<PriceListPanel />);
    const price = await screen.findByText('$5.00');
    expect(price.closest('code, .code-inline, .mono, .serial')).toBeNull();
    expect(price.closest('td')!.getAttribute('dir')).toBeNull();
  });
});

describe('what Bault accepts, on a Hebrew page', () => {
  const POLICY = {
    acceptedClasses: [{ key: 'trading_card', label: 'Trading card', oversized: false, lotEligible: true, lotMinSize: 6, typicalWeightGrams: 5 }],
    refusedCategories: [
      { key: 'gps_tracker', label: 'GPS tracker', prohibited: true, reason: 'A tracker is a powered radio transmitter.' },
    ],
    outcomes: ['destroyed', 'given_away'],
    lotThreshold: 6,
    rules: [{ id: 'closed', heading: 'The accepted list is closed', body: 'Intake will not book a class that is not on this list.' }],
  };

  it('names classes, refusals and outcomes in Hebrew, and keeps the English prose left to right', async () => {
    localStorage.setItem('bault.locale', 'he');
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('The accepted list is closed');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Trading card|GPS tracker|given away|given_away|destroyed/);
    const rule = screen.getByText('Intake will not book a class that is not on this list.');
    expect(rule.closest('[lang="en"]')).not.toBeNull();
    const reason = screen.getByText(/A tracker is a powered radio transmitter/);
    expect(reason.closest('.ltr-run')).not.toBeNull();
  });
});

describe('the console names roles, account states and item states in words', () => {
  const USERS = [
    { id: 'u2', email: 'hermon@bault.dev', username: 'hermon', firstName: 'Hermon', lastName: 'B', nameReviewRequired: false, role: 'warehouse_operator', status: 'suspended', intakeId: null, mfaEnabled: true },
  ];

  it('in Hebrew, on the users tab', async () => {
    localStorage.setItem('bault.locale', 'he');
    window.location.hash = '#/admin/users';
    get.mockImplementation(async (path: string) => (path === '/admin/users' ? USERS : []));
    renderIn(<AdminConsole currentUserId="me" />);
    await screen.findByDisplayValue('Hermon');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/warehouse_operator|suspended|pending|closed\b/);
  });
});
