import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The screens a collector actually looks at.
 *
 * Three things are worth asserting about a page that reads from an API, and none
 * of them are visible to a type checker: that it shows something sensible while
 * loading, that it shows the REASON when the call fails rather than an empty
 * frame, and that an empty result reads as "nothing here yet" rather than as a
 * broken page.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

vi.mock('../../apps/web/src/shared/Barcode', () => ({
  Barcode: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodeLabel: ({ value }: { value: string }) => <span>{value}</span>,
  BarcodePrintButton: () => <button type="button">Print</button>,
}));

const { I18nProvider } = await import('../../apps/web/src/shared/i18n');
const { AccountPill } = await import('../../apps/web/src/shared/ui/PageHeader');
const { IntakePolicyPanel } = await import('../../apps/web/src/areas/customer/help/IntakePolicyPanel');
const { VaultPage } = await import('../../apps/web/src/areas/customer/vault/VaultPage');

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('the account pill in the header', () => {
  it('shows the username — the identifier that goes on a parcel — with the role beside it', () => {
    renderIn(<AccountPill username="red" roleLabel="Collector" suspended={false} />);
    expect(screen.getByText('@red')).toBeInTheDocument();
    expect(screen.getByText('Collector')).toBeInTheDocument();
  });

  it('says the account is suspended, and does not then show a username as if nothing were wrong', () => {
    renderIn(<AccountPill username="red" roleLabel="Collector" suspended />);
    expect(screen.getByText(/account suspended/i)).toBeInTheDocument();
    expect(screen.queryByText('@red')).not.toBeInTheDocument();
  });

  it('falls back to the role for the one frame after sign-in where the username is not loaded yet', () => {
    // The login response does not carry a username; it arrives with the profile
    // request. Rendering a bare "@" for that frame would flash a broken
    // identifier on every single sign-in.
    renderIn(<AccountPill roleLabel="Collector" suspended={false} />);
    expect(screen.getByText('Collector')).toBeInTheDocument();
    expect(screen.queryByText('@')).not.toBeInTheDocument();
  });
});

describe('the published intake policy', () => {
  const POLICY = {
    acceptedClasses: [
      { key: 'trading_card', label: 'Trading card', oversized: false, lotEligible: true, lotMinSize: 6, typicalWeightGrams: 5 },
      { key: 'sealed_case', label: 'Sealed case', oversized: true, lotEligible: false, typicalWeightGrams: 6000 },
    ],
    refusedCategories: [
      { key: 'gps_tracker', label: 'GPS tracker', prohibited: true, reason: 'A tracker is a powered radio transmitter and cannot be stored.' },
      { key: 'no_value', label: 'No processing value', prohibited: false, reason: 'Not a refusal. Some arrivals cost more to process than they are worth.' },
    ],
    outcomes: ['destroyed', 'given_away', 'recycled', 'returned'],
    lotThreshold: 6,
    rules: [{ id: 'trackers', heading: 'Do not put a tracker in a parcel you send us', body: 'One found in an arriving parcel is removed and destroyed.' }],
  };

  it('renders what the API publishes, rather than a copy of the rules', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);

    expect(await screen.findByText('Trading card')).toBeInTheDocument();
    expect(screen.getByText('Sealed case')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/content/intake-policy');
  });

  it('separates a safety refusal from a judgement about value', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');

    // Telling somebody their box of commons was "prohibited" would be a false
    // statement about their property, made by the platform that destroyed it.
    const refused = screen.getByRole('heading', { name: /will not go into a vault/i }).closest('section')!;
    expect(within(refused).getByText('GPS tracker')).toBeInTheDocument();
    expect(within(refused).queryByText('No processing value')).not.toBeInTheDocument();

    const judgement = screen.getByRole('heading', { name: /not worth storing/i }).closest('section')!;
    expect(within(judgement).getByText('No processing value')).toBeInTheDocument();
  });

  it('marks which storage terms each class falls under', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');
    expect(screen.getByText('Oversized')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
  });

  it('states the lot threshold rather than leaving it to be discovered', async () => {
    get.mockResolvedValue(POLICY);
    renderIn(<IntakePolicyPanel />);
    await screen.findByText('Trading card');
    expect(screen.getByText(/6 or more/i)).toBeInTheDocument();
    expect(screen.getByText(/never a lot/i)).toBeInTheDocument();
  });

  it('shows the reason when the policy cannot be loaded, instead of an empty page', async () => {
    get.mockRejectedValue(new Error('The service is unavailable.'));
    renderIn(<IntakePolicyPanel />);
    expect(await screen.findByText(/service is unavailable/i)).toBeInTheDocument();
  });

  it('says it is loading rather than rendering an empty table', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderIn(<IntakePolicyPanel />);
    expect(screen.getByText(/loading|טוען/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('the vault', () => {
  const ITEM = {
    id: 'i1',
    serialNumber: 'SN-DR97-0001',
    barcode: 'SN-DR97-0001',
    typeClass: 'trading_card',
    description: '2003 Pokémon EX Dragon — Rayquaza ex #97/97',
    conditionGrade: 'PSA 9',
    lifecycleState: 'stored',
    binBarcode: 'BIN-QJLTDJH4',
    isLot: false,
    lotSize: 1,
    oversized: false,
  };

  it('lists what the collector owns, with the catalogue detail that identifies it', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [ITEM] : { stored: 1 }),
    );
    renderIn(<VaultPage />);
    // The description appears in the card and again in its detail affordance;
    // what matters is that the catalogue line reached the screen at all.
    await waitFor(() => expect(screen.getAllByText(/Rayquaza ex/).length).toBeGreaterThan(0));
  });

  it('says the vault is empty rather than rendering a blank frame', async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith('/vault/items') ? [] : {}),
    );
    renderIn(<VaultPage />);
    /**
     * An empty state is a sentence, not the absence of one — the difference
     * between "nothing in your vault yet" and a page that looks broken.
     *
     * The wording moved twice: away from "No active cards", because a vault
     * holds comics and sealed boxes too, and towards something that says what to
     * do about it. The matcher is deliberately loose about the exact phrasing
     * and strict about there being one.
     */
    await waitFor(() => {
      const empty = screen.queryByText(/nothing (in your vault|to show)|no (active )?(cards|items)/i);
      expect(empty, 'the vault renders no empty state at all').toBeTruthy();
    });
  });

  it('shows the reason the vault could not be loaded', async () => {
    get.mockRejectedValue(new Error('Could not reach the vault.'));
    renderIn(<VaultPage />);
    expect(await screen.findByText(/could not reach the vault/i)).toBeInTheDocument();
  });
});
