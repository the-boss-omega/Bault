import { describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';

const PARTNER_CHANNELS = [
  { key: 'alt', label: 'Alt', minAskingMinor: 10_000, payoutDaysMin: 7, payoutDaysMax: 21 },
  { key: 'fanatics_collect', label: 'Fanatics Collect', minAskingMinor: 25_000, payoutDaysMin: 30, payoutDaysMax: 60 },
];

describe('DIS consignment through Alt and Fanatics Collect', () => {
  it('lists both channels to a collector with their terms and without the partner fee note', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/services/consignment/channels');
    expect(res.status).toBe(200);
    const channels = res.body.channels as Array<Record<string, unknown>>;
    for (const expected of PARTNER_CHANNELS) {
      const channel = channels.find((c) => c.key === expected.key);
      expect(channel, `${expected.key} is not listed`).toBeDefined();
      expect(channel).toEqual({
        key: expected.key,
        label: expected.label,
        gradedOnly: true,
        minAskingMinor: expected.minAskingMinor,
        requiresEvent: false,
        payoutDaysMin: expected.payoutDaysMin,
        payoutDaysMax: expected.payoutDaysMax,
      });
    }
    for (const channel of channels) expect(channel).not.toHaveProperty('partnerFeeNote');
  });

  for (const channel of PARTNER_CHANNELS) {
    describe(channel.label, () => {
      it('takes a graded card at its minimum', async () => {
        const operator = await signIn(SEED.operator);
        const collector = await signIn(SEED.collector);
        const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', conditionGrade: 'PSA 10' });
        const res = await collector.post('/services/consignment', {
          itemId: card.id,
          channel: channel.key,
          askingMinor: channel.minAskingMinor,
        });
        expect(res.status).toBe(201);
        expect(res.body.typeFields).toMatchObject({
          channel: channel.key,
          askingMinor: channel.minAskingMinor,
          payoutDaysMin: channel.payoutDaysMin,
          payoutDaysMax: channel.payoutDaysMax,
        });
      });

      it('refuses an ungraded card', async () => {
        const operator = await signIn(SEED.operator);
        const collector = await signIn(SEED.collector);
        const card = await intakeFor(operator, SEED.collector, { conditionGrade: 'Raw' });
        const res = await collector.post('/services/consignment', {
          itemId: card.id,
          channel: channel.key,
          askingMinor: channel.minAskingMinor * 2,
        });
        expect(res.status).toBe(400);
        expect(String(res.body.error.message)).toMatch(/graded items only/);
      });

      it('refuses an asking price below its minimum', async () => {
        const operator = await signIn(SEED.operator);
        const collector = await signIn(SEED.collector);
        const card = await intakeFor(operator, SEED.collector, { typeClass: 'graded_slab', conditionGrade: 'BGS 9.5' });
        const res = await collector.post('/services/consignment', {
          itemId: card.id,
          channel: channel.key,
          askingMinor: channel.minAskingMinor - 1,
        });
        expect(res.status).toBe(400);
        expect(String(res.body.error.message)).toContain(`${channel.label} has a minimum of`);
      });
    });
  }
});
