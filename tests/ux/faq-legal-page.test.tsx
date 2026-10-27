import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  apiErrorKey: () => null,
  isUnreachable: () => false,
}));

const { FaqLegalPage } = await import('../../apps/web/src/areas/customer/help/FaqLegalPage');
const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { TERMS_VERSION } = await import('../../apps/web/src/areas/customer/help/legalContent');

const TERMS = {
  termsVersion: TERMS_VERSION,
  debt: { graceDays: 14, interestBpsPerDay: 5, suspendBelowMinor: -2000 },
  cashOut: { bandMinor: 10_000, smallBps: 600, smallMinimumMinor: 99, largeFixedMinor: 500, largeBps: 100 },
  chargebackFeeMinor: 2_500,
  escrow: { feeBps: 100, minimumFeeMinor: 2_500, minimumValueMinor: 50_000 },
  shipping: {
    restockingFeeMinor: 2_500,
    paymentWindowDays: 7,
    insurancePremiumBps: 150,
    insuranceMinimumPremiumMinor: 200,
    maxInsuredValueMinor: 500_000,
    signatureRequiredAboveMinor: 50_000,
  },
  removeCommonsWindowDays: 30,
};

function renderAt(hash: string) {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <FaqLegalPage />
    </I18nProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((path: string) =>
    path === '/content/account-terms' ? Promise.resolve(TERMS) : Promise.resolve([]),
  );
  try {
    localStorage.setItem('bault.locale', 'en');
  } catch {
  }
});

describe('FAQ & Legal', () => {
  it('shows Bault’s own FAQ, with no other company in it', async () => {
    renderAt('#/faq/faq');
    expect(await screen.findByText('What is Bault?')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ship\s*my\s*cards/i);
    expect(screen.getByText(/answers, last checked against the product/i)).toBeInTheDocument();
  });

  it('puts the draft banner and the version above the terms', async () => {
    renderAt('#/faq/legal');
    const panel = (await screen.findByRole('heading', { name: 'Terms of Service', level: 2 })).closest('section')!;
    const banner = within(panel).getByRole('note');
    expect(banner).toHaveTextContent('DRAFT — must be reviewed by a lawyer before launch');
    expect(banner).toHaveTextContent(TERMS_VERSION);
    expect(within(panel).getByText(new RegExp(`Version ${TERMS_VERSION}`))).toBeInTheDocument();
  });

  it('shows the figures the documents point at, from the API', async () => {
    renderAt('#/faq/legal');
    expect(await screen.findByText('14 days')).toBeInTheDocument();
    expect(screen.getByText('0.05% a day, compounding')).toBeInTheDocument();
    expect(screen.getByText('-$20.00')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/content/account-terms');
  });

  it('draws the suspension threshold as an amount of its own, so its minus stays in front of it in Hebrew', async () => {
    localStorage.setItem('bault.locale', 'he');
    renderAt('#/faq/legal');
    const threshold = await screen.findByText('-$20.00');

    // Left to right and isolated: a bare "-$20.00" in a right-to-left cell is drawn "$20.00-".
    expect(threshold).toHaveClass('amount');
    expect(threshold).toHaveAttribute('dir', 'ltr');
  });
});
