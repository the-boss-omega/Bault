import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { billableActions, coverage } from '../../apps/api/src/modules/prc/billable-actions';
import { MEMBERSHIP_TIERS } from '../../apps/api/src/modules/mem/tiers';

/**
 * The admin console's editing screens: the pricing form, and the user and item
 * rows.
 *
 * `api` is mocked at the module boundary: what is pinned is which request each
 * button sends. The pricing catalogue is the API's own (`billable-actions.ts`),
 * read through the coverage check exactly as the endpoint builds it, so an
 * action added to the code shows up here without anybody editing this file.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();

vi.mock('../../apps/web/src/shared/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
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

function renderIn(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

/** The coverage check on a database built by migration alone: not one rule. */
const UNPRICED = JSON.parse(JSON.stringify(coverage(billableActions(), []))) as ReturnType<typeof coverage>;

/** `GET /membership/tiers`, as `MembershipService.catalogue` builds it. */
const TIERS = {
  tiers: MEMBERSHIP_TIERS.map((t) => ({ ...t, priceMinor: t.listPriceMinor })),
  uncovered: [],
  cycleDays: 30,
  currency: 'USD',
};

function consoleApi(overrides: Record<string, unknown> = {}) {
  get.mockImplementation(async (path: string) => {
    if (path in overrides) return overrides[path];
    if (path === '/admin/pricing/coverage') return UNPRICED;
    if (path === '/membership/tiers') return TIERS;
    return [];
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  window.location.hash = '';
});

/* ============================================================
   Pricing: every price the coverage check asks for can be loaded
   ============================================================ */

/** The new-rule form's action picker, once the catalogue is in it. */
async function actionPicker() {
  const select = (await screen.findByRole('combobox', { name: /^action/i })) as HTMLSelectElement;
  await waitFor(() => expect(select.querySelector('option[value="parcel_forwarding"]')).not.toBeNull());
  return select;
}

async function addRule(user: ReturnType<typeof userEvent.setup>, actionType: string, dollars: string) {
  const select = await actionPicker();
  await user.selectOptions(select, actionType);
  await user.type(screen.getByPlaceholderText('Rule description'), `Rule for ${actionType}`);
  await user.type(screen.getByLabelText('Flat amount'), dollars);
  await user.click(screen.getByRole('button', { name: /add rule/i }));
}

describe('the pricing form', () => {
  it('offers every action the coverage check can report missing', async () => {
    consoleApi();
    window.location.hash = '#/admin/pricing';
    renderIn(<AdminConsole currentUserId="me" />);

    const missing = UNPRICED.actions.filter((a) => a.status === 'missing').map((a) => a.actionType);
    // The ones the launch plan stalls on, by name, so a catalogue that stopped
    // reporting them could not make this pass by having nothing to check.
    expect(missing).toEqual(
      expect.arrayContaining(['parcel_processing', 'parcel_forwarding', 'membership:folio', 'membership:trust']),
    );

    let offered: string[] = [];
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: /^action/i }) as HTMLSelectElement;
      offered = [...select.options].map((o) => o.value);
      expect(offered).toEqual(expect.arrayContaining(missing));
    });
    // And everything else the API bills, so no rule has to be loaded by hand.
    expect(new Set(offered)).toEqual(new Set(UNPRICED.actions.map((a) => a.actionType)));
  });

  it('prices parcel forwarding from the screen', async () => {
    const user = userEvent.setup();
    consoleApi();
    post.mockResolvedValue({});
    window.location.hash = '#/admin/pricing';
    renderIn(<AdminConsole currentUserId="me" />);

    await addRule(user, 'parcel_forwarding', '4.00');
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/pricing/rules',
        expect.objectContaining({ actionType: 'parcel_forwarding', model: 'fixed', value: 400 }),
      ),
    );
  });

  it("a membership price carries the tier's allowances, which the storage sweep reads off the rule", async () => {
    const user = userEvent.setup();
    consoleApi();
    post.mockResolvedValue({});
    window.location.hash = '#/admin/pricing';
    renderIn(<AdminConsole currentUserId="me" />);

    const folio = MEMBERSHIP_TIERS.find((t) => t.key === 'folio')!;
    await addRule(user, folio.feeActionType, '39.00');
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/pricing/rules');
    // The shape the seed writes. Without `storedItems` the nightly sweep covers
    // none of a member's items and bills storage on every one of them.
    expect(body).toMatchObject({
      actionType: 'membership:folio',
      value: 3900,
      parameters: {
        storedItems: folio.storedItems,
        insuredShipments: folio.insuredShipments,
        insuredValueCapMinor: folio.insuredValueCapMinor,
        postageCreditMinor: folio.postageCreditMinor,
        commissionWaivedOnMinor: folio.commissionWaivedOnMinor,
      },
    });
  });

  it('sends no parameters for an action whose rule carries none', async () => {
    const user = userEvent.setup();
    consoleApi();
    post.mockResolvedValue({});
    window.location.hash = '#/admin/pricing';
    renderIn(<AdminConsole currentUserId="me" />);

    await addRule(user, 'parcel_processing', '2.00');
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).not.toHaveProperty('parameters');
  });
});

/* ============================================================
   Users: a save sends what the administrator changed, nothing else
   ============================================================ */

const DEBTOR = {
  id: 'u1',
  email: 'debtor@bault.dev',
  username: 'debtor',
  firstName: 'Dee',
  lastName: 'Btor',
  nameReviewRequired: false,
  role: 'user',
  // Suspended by the debt sweep: the server lifts it once the balance recovers,
  // unless somebody sets a status.
  status: 'suspended',
  intakeId: null,
  mfaEnabled: false,
};

describe('saving a user row', () => {
  it('sends only the name when only the name changed, not the status the row was showing', async () => {
    const user = userEvent.setup();
    consoleApi({ '/admin/users': [DEBTOR] });
    patch.mockResolvedValue({ ...DEBTOR, firstName: 'Dana' });
    window.location.hash = '#/admin/users';
    renderIn(<AdminConsole currentUserId="me" />);

    const first = await screen.findByRole('textbox', { name: 'First name' });
    await user.clear(first);
    await user.type(first, 'Dana');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/admin/users/u1', { firstName: 'Dana' });
  });

  it('sends the status when the administrator changes it', async () => {
    const user = userEvent.setup();
    consoleApi({ '/admin/users': [DEBTOR] });
    patch.mockResolvedValue({ ...DEBTOR, status: 'active' });
    window.location.hash = '#/admin/users';
    renderIn(<AdminConsole currentUserId="me" />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'active');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/admin/users/u1', { status: 'active' });
  });
});

/* ============================================================
   Items: a save sends what the administrator changed, nothing else
   ============================================================ */

const LISTED_CARD = {
  id: 'i1',
  serialNumber: 'SN-1',
  barcode: 'BLT-0001',
  typeClass: 'trading_card',
  description: 'Charizard',
  conditionGrade: null,
  lifecycleState: 'listed',
  holdFlag: false,
  binId: null,
  ownerId: 'u1',
  ownerEmail: DEBTOR.email,
};
const BUYER = { ...DEBTOR, id: 'u2', email: 'buyer@bault.dev', username: 'buyer', status: 'active' };

describe('saving an item row', () => {
  it('sends only the new owner, not the `listed` state the row was showing', async () => {
    const user = userEvent.setup();
    consoleApi({ '/admin/users': [DEBTOR, BUYER], '/admin/items': [LISTED_CARD] });
    patch.mockResolvedValue({});
    window.location.hash = '#/admin/items';
    renderIn(<AdminConsole currentUserId="me" />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Owner' }), 'u2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    // The server takes the card off sale and back to `stored`; a `listed` sent
    // alongside would keep it listed with no listing.
    expect(patch).toHaveBeenCalledWith('/admin/items/i1', { ownerId: 'u2' });
  });

  it('sends the state when the administrator changes it', async () => {
    const user = userEvent.setup();
    consoleApi({ '/admin/users': [DEBTOR, BUYER], '/admin/items': [LISTED_CARD] });
    patch.mockResolvedValue({});
    window.location.hash = '#/admin/items';
    renderIn(<AdminConsole currentUserId="me" />);

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Lifecycle' }), 'on-hold');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/admin/items/i1', { lifecycleState: 'on-hold' });
  });
});
