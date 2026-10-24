import { describe, it, expect } from 'vitest';
import { SEED, fundWallet, intakeFor, signIn, type Client } from './helpers/http';

describe('DIS services on a stored item', () => {
  async function freshItem(overrides: Record<string, unknown> = {}) {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      ...overrides,
    });
    return { operator, item };
  }

  async function accepted(operator: Client, requestId: string) {
    const res = await operator.post(`/services/requests/${requestId}/accept`);
    expect(res.status).toBe(201);
  }

  it('publishes the tier catalogue with its ceilings and turnarounds', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/services/grading/tiers');
    expect(res.status).toBe(200);
    const tiers = res.body.tiers as Array<Record<string, unknown>>;
    expect(tiers.length).toBeGreaterThan(0);
    for (const tier of tiers) {
      expect(typeof tier.maxDeclaredMinor).toBe('number');
      expect(typeof tier.turnaroundDaysMin).toBe('number');
      expect(typeof tier.requiresApproval).toBe('boolean');
    }
    expect(res.body.walkthroughThresholdMinor).toBeGreaterThan(0);
  });

  it('refuses a declared value above the tier ceiling, before charging anything', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/services/grading', {
      itemId: item.id,
      tier: 'psa_value',
      declaredMinor: 500_000,
    });
    expect(res.status).toBe(400);

    const mine = (await collector.get('/services/mine')).body as Array<{ itemId: string }>;
    expect(mine.some((r) => r.itemId === item.id)).toBe(false);
  });

  it('refuses the top tier for a card that does not need it', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/services/grading', {
      itemId: item.id,
      tier: 'psa_walkthrough',
      declaredMinor: 5_000,
    });
    expect(res.status).toBe(400);
  });

  it('holds a walkthrough request out of a submission until an admin approves it', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (
      await collector.post('/services/grading', {
        itemId: item.id,
        tier: 'psa_walkthrough',
        declaredMinor: 800_000,
      })
    ).body;
    expect(req.typeFields.approvalState).toBe('pending');
    await accepted(operator, req.id);

    const before = (await operator.get('/services/grading/submissions/ready?gradingBody=PSA'))
      .body as Array<{ id: string }>;
    expect(before.some((r) => r.id === req.id)).toBe(false);

    const admin = await signIn(SEED.admin);
    const decided = await admin.post(`/services/grading/${req.id}/approval`, {
      approve: true,
      reason: 'Value verified against recent comps.',
    });
    expect(decided.status).toBe(201);

    const after = (await operator.get('/services/grading/submissions/ready?gradingBody=PSA'))
      .body as Array<{ id: string }>;
    expect(after.some((r) => r.id === req.id)).toBe(true);
  });

  it('refunds and closes a walkthrough request an admin refuses', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    await fundWallet(SEED.collector, 100_000);
    const before = await walletOf(collector);
    const req = (
      await collector.post('/services/grading', {
        itemId: item.id,
        tier: 'psa_walkthrough',
        declaredMinor: 800_000,
      })
    ).body;
    expect(await walletOf(collector)).toBeLessThan(before);

    const admin = await signIn(SEED.admin);
    const refused = await admin.post(`/services/grading/${req.id}/approval`, {
      approve: false,
      reason: 'Declared value is not supported by comps.',
    });
    expect(refused.status).toBe(201);
    expect(refused.body.status).toBe('cancelled');
    expect(await walletOf(collector)).toBe(before);

    const again = await admin.post(`/services/grading/${req.id}/approval`, { approve: false, reason: 'Twice.' });
    expect(again.status).toBe(409);
    expect(await walletOf(collector)).toBe(before);
  });

  it('takes the card out of circulation while it is at the grader, and brings it back', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (
      await collector.post('/services/grading', {
        itemId: item.id,
        tier: 'psa_regular',
        declaredMinor: 50_000,
      })
    ).body;
    await accepted(operator, req.id);

    const submission = (await operator.post('/services/grading/submissions', { gradingBody: 'PSA' }))
      .body;
    expect(submission.code).toMatch(/^GSB-/);

    const added = await operator.post(`/services/grading/submissions/${submission.id}/add`, {
      requestId: req.id,
    });
    expect(added.status).toBe(201);

    const shipped = await operator.post(`/services/grading/submissions/${submission.id}/ship`, {
      trackingNumber: '9400111899223197428490',
      externalReference: 'PSA-SUB-77123',
      notes: 'One card, insured to declared value.',
    });
    expect(shipped.status).toBe(201);
    expect(shipped.body.itemCount).toBe(1);

    const away = (await collector.get(`/vault/items/${item.id}`)).body;
    expect(away.item.lifecycleState).toBe('at_grader');

    const listed = await collector.post('/marketplace/listings', {
      itemId: item.id,
      price: 25_000,
      currency: 'USD',
    });
    expect(listed.status).toBeGreaterThanOrEqual(400);

    const early = await operator.post(`/services/grading/submissions/${submission.id}/close`);
    expect(early.status).toBe(409);

    const done = await operator.post(`/services/grading/${req.id}/complete`, {
      grade: 'PSA 9',
      gradingBody: 'PSA',
      certificateNumber: 'PSA-99887766',
      itemVerified: true,
      notes: 'Returned sealed.',
    });
    expect(done.status).toBe(201);

    const back = (await collector.get(`/vault/items/${item.id}`)).body;
    expect(back.item.lifecycleState).toBe('stored');
    expect(back.item.conditionGrade).toBe('PSA 9');

    const closed = await operator.post(`/services/grading/submissions/${submission.id}/close`);
    expect(closed.status).toBe(201);
  });

  it('does not send a card whose grade was already recorded with the rest of its batch', async () => {
    const { operator, item: graded } = await freshItem({ description: 'F048: graded before the batch left' });
    const { item: travelling } = await freshItem({ description: 'F048: travels with the batch' });
    const collector = await signIn(SEED.collector);

    const submission = (await operator.post('/services/grading/submissions', { gradingBody: 'PSA' })).body;
    const requestIds: string[] = [];
    for (const it of [graded, travelling]) {
      const req = (
        await collector.post('/services/grading', { itemId: it.id, tier: 'psa_regular', declaredMinor: 50_000 })
      ).body;
      await accepted(operator, req.id);
      const added = await operator.post(`/services/grading/submissions/${submission.id}/add`, { requestId: req.id });
      expect(added.status).toBe(201);
      requestIds.push(req.id);
    }

    const early = await operator.post(`/services/grading/${requestIds[0]}/complete`, {
      grade: 'PSA 8',
      gradingBody: 'PSA',
      certificateNumber: 'PSA-F048-0001',
      itemVerified: true,
      notes: 'Graded on site before the batch shipped.',
    });
    expect(early.status).toBe(201);

    const shipped = await operator.post(`/services/grading/submissions/${submission.id}/ship`, {
      trackingNumber: '9400111899223197428491',
      externalReference: 'PSA-SUB-F048',
      notes: 'One card left; the other was already graded.',
    });
    expect(shipped.status).toBe(201);
    expect(shipped.body.itemCount).toBe(1);

    const stayed = (await collector.get(`/vault/items/${graded.id}`)).body;
    expect(stayed.item.lifecycleState).toBe('stored');
    const went = (await collector.get(`/vault/items/${travelling.id}`)).body;
    expect(went.item.lifecycleState).toBe('at_grader');
  });

  it('attaches a video as a media version on the item', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (await collector.post('/services/video', { itemId: item.id })).body;
    await accepted(operator, req.id);

    const done = await operator.post(`/services/video/${req.id}/complete`, {
      objectKey: 'video/turn-1.mp4',
      durationSeconds: 24,
      itemVerified: true,
      notes: 'Turned under a diffused key light.',
    });
    expect(done.status).toBe(201);

    const card = (await collector.get(`/vault/items/${item.id}`)).body;
    expect((card.images as Array<{ type: string }>).some((i) => i.type === 'video')).toBe(true);
  });

  it('will not close an inspection with a requested area left unanswered', async () => {
    const { operator, item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const req = (
      await collector.post('/services/inspection', {
        itemId: item.id,
        areas: ['corners', 'surface'],
      })
    ).body;
    await accepted(operator, req.id);

    const partial = await operator.post(`/services/inspection/${req.id}/complete`, {
      findings: [{ area: 'corners', severity: 'clean', note: 'Sharp on all four.' }],
      itemVerified: true,
      notes: 'Bench inspection.',
    });
    expect(partial.status).toBe(400);

    const full = await operator.post(`/services/inspection/${req.id}/complete`, {
      findings: [
        { area: 'corners', severity: 'clean', note: 'Sharp on all four.' },
        { area: 'surface', severity: 'minor', note: 'One print line under raking light.' },
      ],
      itemVerified: true,
      notes: 'Bench inspection.',
    });
    expect(full.status).toBe(201);
  });

  it('refuses to crack a card that was never graded', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/services/deslab', { itemId: item.id });
    expect(res.status).toBe(400);
  });

  it('clears the grade when a slab is cracked', async () => {
    const { operator, item } = await freshItem({ conditionGrade: 'PSA 10' });
    const collector = await signIn(SEED.collector);

    const challenge = (await collector.post('/services/deslab', { itemId: item.id })).body;
    expect(challenge.confirmationToken).toBeTruthy();
    const req = (
      await collector.post('/services/deslab/confirm', {
        confirmationToken: challenge.confirmationToken,
      })
    ).body;
    await accepted(operator, req.id);

    const done = await operator.post(`/services/deslab/${req.id}/complete`, {
      itemVerified: true,
      conditionAfter: 'Raw — NM, one soft bottom-left corner',
      notes: 'Holder cut, card sleeved and toploaded.',
    });
    expect(done.status).toBe(201);

    const card = (await collector.get(`/vault/items/${item.id}`)).body;
    expect(card.item.conditionGrade).not.toBe('PSA 10');
  });

  async function sellTo(sellerEmail: string, buyerEmail: string, itemId: string) {
    const seller = await signIn(sellerEmail);
    const listed = await seller.post('/marketplace/listings', { itemId, askingPrice: 5_000 });
    expect(listed.status).toBe(201);
    await fundWallet(buyerEmail, 10_000);
    const bought = await (await signIn(buyerEmail)).post(`/marketplace/listings/${listed.body.id}/purchase`);
    expect(bought.status).toBe(201);
  }

  const walletOf = async (c: Client) => ((await c.get('/finance/wallet')).body as { amount: number }).amount;

  it('refuses to crack a slab that changed hands after it was asked for, and charges nothing', async () => {
    const { item } = await freshItem({ conditionGrade: 'PSA 9', description: 'Deslab sold mid-confirmation' });
    const collector = await signIn(SEED.collector);
    const challenge = (await collector.post('/services/deslab', { itemId: item.id })).body;
    expect(challenge.confirmationToken).toBeTruthy();

    await sellTo(SEED.collector, SEED.collector2, item.id);

    const before = await walletOf(collector);
    const confirmed = await collector.post('/services/deslab/confirm', {
      confirmationToken: challenge.confirmationToken,
    });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe('item_no_longer_available');
    expect(await walletOf(collector)).toBe(before);

    const mine = (await collector.get('/services/mine')).body as { type: string; itemId: string }[];
    expect(mine.some((r) => r.type === 'deslab' && r.itemId === item.id)).toBe(false);
    const card = (await (await signIn(SEED.collector2)).get(`/vault/items/${item.id}`)).body;
    expect(card.item.conditionGrade).toBe('PSA 9');
  });

  it('refuses to crack a slab put on hold after it was asked for', async () => {
    const { operator, item } = await freshItem({ conditionGrade: 'BGS 9.5', description: 'Deslab held mid-confirmation' });
    const collector = await signIn(SEED.collector);
    const challenge = (await collector.post('/services/deslab', { itemId: item.id })).body;

    expect((await operator.post(`/custody/items/${item.id}/hold`)).status).toBe(201);
    const confirmed = await collector.post('/services/deslab/confirm', {
      confirmationToken: challenge.confirmationToken,
    });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe('item_on_hold');
  });

  it('does not crack a slab that was sold after the request was accepted', async () => {
    const { operator, item } = await freshItem({ conditionGrade: 'CGC 9', description: 'Deslab sold before the bench' });
    const collector = await signIn(SEED.collector);
    const challenge = (await collector.post('/services/deslab', { itemId: item.id })).body;
    const req = (
      await collector.post('/services/deslab/confirm', { confirmationToken: challenge.confirmationToken })
    ).body;
    await accepted(operator, req.id);

    await sellTo(SEED.collector, SEED.collector2, item.id);

    const done = await operator.post(`/services/deslab/${req.id}/complete`, {
      itemVerified: true,
      conditionAfter: 'Raw',
      notes: 'Holder cut.',
    });
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('item_no_longer_available');
    const card = (await (await signIn(SEED.collector2)).get(`/vault/items/${item.id}`)).body;
    expect(card.item.conditionGrade).toBe('CGC 9');

    const before = await walletOf(collector);
    const closed = await operator.post(`/services/requests/${req.id}/deny`);
    expect(closed.status).toBe(201);
    expect(closed.body.status).toBe('cancelled');
    expect(await walletOf(collector)).toBeGreaterThan(before);
    expect((await operator.post(`/services/requests/${req.id}/deny`)).status).toBe(409);
  });

  it('lets the owner ask for a lot to be split, and produces one item per card', async () => {
    const operator = await signIn(SEED.operator);
    const lot = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      isLot: true,
      lotSize: 8,
    });
    const collector = await signIn(SEED.collector);

    const req = (await collector.post('/services/lot-split', { itemId: lot.id })).body;
    expect(req.type).toBe('batch_split');
    await accepted(operator, req.id);

    const done = await operator.post(`/services/lot-split/${req.id}/complete`, {
      itemVerified: true,
      notes: 'Separated, sleeved and re-binned.',
    });
    expect(done.status).toBe(201);

    const parent = (await collector.get(`/vault/items/${lot.id}`)).body;
    expect(parent.item.lotBroken).toBe(true);
  });

  it('refuses to split the same lot twice', async () => {
    const operator = await signIn(SEED.operator);
    const single = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/services/lot-split', { itemId: single.id });
    expect(res.status).toBe(400);
  });

  it('removes several commons in one confirmed action, free of charge', async () => {
    const operator = await signIn(SEED.operator);
    const a = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const b = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);

    const challenge = (
      await collector.post('/services/remove-commons', {
        itemIds: [a.id, b.id],
        outcome: 'discard',
      })
    ).body;
    expect(challenge.confirmationToken).toBeTruthy();

    const done = (
      await collector.post('/services/remove-commons/confirm', {
        confirmationToken: challenge.confirmationToken,
      })
    ).body;
    expect(done.count).toBe(2);

    const card = (await collector.get(`/vault/items/${a.id}`)).body;
    expect(card.item.lifecycleState).toBe('discarded');
  });

  it('refuses to cull a card that belongs to somebody else', async () => {
    const operator = await signIn(SEED.operator);
    const mine = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const theirs = await intakeFor(operator, SEED.collector2, { typeClass: 'trading_card' });
    const collector = await signIn(SEED.collector);

    const res = await collector.post('/services/remove-commons', {
      itemIds: [mine.id, theirs.id],
      outcome: 'discard',
    });
    expect(res.status).toBe(403);

    const still = (await collector.get(`/vault/items/${mine.id}`)).body;
    expect(still.item.lifecycleState).toBe('stored');
  });
});
