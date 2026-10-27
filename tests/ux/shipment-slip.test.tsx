import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  apiErrorKey: () => null,
  ApiError: class ApiError extends Error {},
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { ShipmentComposer } = await import('../../apps/web/src/areas/customer/shipping/ShipmentComposer');

const COUNTRIES = [{ code: 'US', name: 'United States', domestic: true, regionRequired: false, regions: [] }];
const CATALOGUE = {
  services: [],
  addOns: [],
  boxes: [],
  maxInsuredValueMinor: 100_000,
  signatureRequiredAboveMinor: 50_000,
  paymentWindowDays: 7,
};
const ADDRESS = { id: 'a1', label: 'Home', recipient: 'Red Ashwood', line1: '12 Vine St', city: 'Trenton', region: 'NJ', country: 'US', postalCode: '08608', isDefault: true };
const ITEMS = [
  { id: 'i1', serialNumber: 'SN-CL10-0005', typeClass: 'trading_card', description: '2011 Pokémon Call of Legends — Rayquaza' },
  { id: 'i2', serialNumber: 'SN-DR97-0001', typeClass: 'trading_card', description: '2003 Pokémon EX Dragon — Rayquaza' },
];
const RATE = {
  carrier: 'USPS',
  serviceLevel: 'Priority',
  serviceKey: 'usps_priority',
  costMinor: 700,
  currency: 'USD',
  estimatedDays: 3,
  problems: [],
  eligible: true,
  transitDaysMin: 2,
  transitDaysMax: 3,
  maxInsuredValueMinor: 100_000,
  handlingMinor: 300,
  insurancePremiumMinor: 0,
  addOnsMinor: 0,
  totalMinor: 1000,
  recommended: true,
};
const QUOTE = {
  destination: { country: 'US', postalCode: '08608' },
  totalWeightGrams: 120,
  boxSize: null,
  weightEstimated: false,
  itemCount: 2,
  insuredValueMinor: 0,
  declaredValueMinor: 0,
  signatureRequired: false,
  needsCustoms: false,
  rates: [RATE],
  optionProblems: [],
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  localStorage.setItem('bault.locale', 'en');
  get.mockImplementation(async (path: string) => {
    if (path === '/shipping/countries') return COUNTRIES;
    if (path === '/shipping/services') return CATALOGUE;
    if (path === '/me/addresses') return [ADDRESS];
    return [];
  });
  post.mockImplementation(async (path: string) => (path === '/shipping/quote' ? QUOTE : {}));
});

function composer() {
  return render(
    <I18nProvider>
      <ShipmentComposer items={ITEMS} onError={() => {}} onStatus={() => {}} onCreated={() => {}} />
    </I18nProvider>,
  );
}

describe('a shipment, written on a slip while it is chosen', () => {
  it('says where it goes, how many are going and what it comes to once the cards and the address are chosen', async () => {
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    // Nothing chosen: no price, and what is missing.
    expect(slip).toHaveTextContent('Choose items and a destination to see prices.');
    await waitFor(() => expect(within(slip).getByText('Destination').nextElementSibling).toHaveTextContent('Trenton, United States'));

    for (const checkbox of screen.getAllByRole('checkbox').slice(0, 2)) await user.click(checkbox);
    await waitFor(() => expect(slip.querySelector('.drawer-tag-amount')).toHaveTextContent('$10.00'));
    expect(slip).toHaveTextContent('2 selected');
    expect(slip).toHaveTextContent('2–3 days');
  });

  it('adds what was asked for as it is asked for: express, the cover and the signature it makes necessary', async () => {
    composer();
    const user = userEvent.setup();
    const slip = await screen.findByRole('region', { name: 'Price' });
    expect(within(slip).queryByText('Express shipping')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Express shipping' }));
    expect(within(slip).getByText('Express shipping')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Insured value'), '600');
    expect(within(slip).getByText('Insured value').nextElementSibling).toHaveTextContent('$600.00');
    // Above the threshold a signature is required, so it is on the slip whether or not it was ticked.
    expect(within(slip).getByText('Signature on delivery')).toBeInTheDocument();
  });
});
