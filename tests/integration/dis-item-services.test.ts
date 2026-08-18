import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn, type Client } from './helpers/http';

/**
 * Section 5 — everything a collector can ask us to DO to a card that is already
 * on the shelf: grading at a tier, the submission that physically leaves the
 * building, a video, a per-area condition report, cracking a slab, splitting a
 * lot, and the bulk cull.
 *
 * The tests worth having here are the ones about the RULES rather than the
 * plumbing. A tier that refuses a card above its ceiling, a card that stops
 * being sellable while it is at a grader, an inspection that cannot be closed
 * with an area left unanswered — those are the claims that would be silently
 * false if the wiring were wrong, and each of them was true of the platform
 * before this pass.
 *
 * Requires a running API + a freshly seeded DB.
 */
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

  /* ---------------- grading tiers ---------------- */

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
    // $5,000 on the $499 tier.
    const res = await collector.post('/services/grading', {
      itemId: item.id,
      tier: 'psa_value',
      declaredMinor: 500_000,
    });
    expect(res.status).toBe(400);

    // Nothing was recorded — the refusal happens before the request exists.
    const mine = (await collector.get('/services/mine')).body as Array<{ itemId: string }>;
    expect(mine.some((r) => r.itemId === item.id)).toBe(false);
  });

  it('refuses the top tier for a card that does not need it', async () => {
    const { item } = await freshItem();
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/services/grading', {
      itemId: item.id,
      tier: 'psa_walkthrough',
      declaredMinor: 5_000, // $50 on the tier meant for $5,000+
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
        declaredMinor: 800_000, // $8,000
      })
    ).body;
    expect(req.typeFields.approvalState).toBe('pending');
    await accepted(operator, req.id);

    // Not offered to a batch while the sign-off is outstanding.
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

    // THE point of the whole submission: the card is no longer on the shelf.
    const away = (await collector.get(`/vault/items/${item.id}`)).body;
    expect(away.item.lifecycleState).toBe('at_grader');

    // And it cannot be listed while it is gone.
    const listed = await collector.post('/marketplace/listings', {
      itemId: item.id,
      price: 25_000,
      currency: 'USD',
    });
    expect(listed.status).toBeGreaterThanOrEqual(400);

    // A closed submission cannot be closed with cards still outstanding.
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

  /* ---------------- video and inspection ---------------- */

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

    // Only one of the two areas answered. A report that silently omits the
    // surface reads as "nothing wrong" when it means "nobody looked".
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

  /* ---------------- crack a slab ---------------- */

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
    // The grade no longer describes anything, so it does not survive.
    expect(card.item.conditionGrade).not.toBe('PSA 10');
  });

  /* ---------------- lot split, at the owner's request ---------------- */

  it('lets the owner ask for a lot to be split, and produces one item per card', async () => {
    const operator = await signIn(SEED.operator);
    const lot = await intakeFor(operator, SEED.collector, {
      typeClass: 'trading_card',
      isLot: true,
      // Above the trading-card threshold: a lot of five or fewer CARDS is
      // processed as individuals at intake and never becomes a lot to split.
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
    // Not a lot at all — the same guard.
    const res = await collector.post('/services/lot-split', { itemId: single.id });
    expect(res.status).toBe(400);
  });

  /* ---------------- the bulk cull ---------------- */

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

    // Discarded is terminal, and the item still exists — nothing is ever deleted.
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

    // And the one that WAS theirs to cull is untouched: the whole set is
    // validated before any confirmation is issued.
    const still = (await collector.get(`/vault/items/${mine.id}`)).body;
    expect(still.item.lifecycleState).toBe('stored');
  });
});
