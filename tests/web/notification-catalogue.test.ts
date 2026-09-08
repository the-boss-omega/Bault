import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  defaultEnabled,
  isMandatory,
} from '../../apps/api/src/modules/not/event-types';
import { defaultEmailEnabled, eventSubject } from '../../apps/worker/src/jobs/notification-events';
import { EVENT_LABEL_KEY } from '../../apps/web/src/shared/notifications';

/**
 * The API's event catalogue and the worker's mirror must agree.
 *
 * They are separate modules on purpose — the worker is deliberately independent
 * of the Nest container and cannot import from the API tree, the same
 * arrangement the item taxonomy has with the SPA. That independence is worth
 * having and it has exactly one failure mode: the two drift, and an event
 * quietly starts or stops sending mail because somebody edited one file.
 *
 * This is the test that makes the duplication safe. It is in the `web` project
 * because it needs no database and no running server: it is two arrays and a
 * comparison.
 */
describe('notification catalogue', () => {
  it('agrees with the worker about which events go out by email', () => {
    const disagreements = NOTIFICATION_EVENT_TYPES.filter(
      (event) => event.emailByDefault !== defaultEmailEnabled(event.key),
    ).map((event) => event.key);

    expect(disagreements).toEqual([]);
  });

  it('gives every event type a subject line', () => {
    // The fallback exists so an unregistered event still sends SOMETHING, but a
    // registered one falling through to it means somebody added an entry to the
    // catalogue and not to the subjects.
    const generic = eventSubject('a-key-that-does-not-exist');
    const missing = NOTIFICATION_EVENT_TYPES.filter((e) => eventSubject(e.key) === generic).map(
      (e) => e.key,
    );
    expect(missing).toEqual([]);
  });

  it('has no duplicate keys', () => {
    const keys = NOTIFICATION_EVENT_TYPES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('defaults in-app to on for everything, and email only where the catalogue says', () => {
    for (const event of NOTIFICATION_EVENT_TYPES) {
      expect(defaultEnabled(event.key, 'in_app')).toBe(true);
      expect(defaultEnabled(event.key, 'email')).toBe(event.emailByDefault);
    }
    // An unregistered event still reaches the collector in-app, and cannot start
    // sending mail without a deliberate entry.
    expect(defaultEnabled('not_registered', 'in_app')).toBe(true);
    expect(defaultEnabled('not_registered', 'email')).toBe(false);
  });

  it('only makes in-app mandatory, and only for the two that carry bad news', () => {
    const mandatory = NOTIFICATION_EVENT_TYPES.filter((e) => isMandatory(e.key, 'in_app')).map(
      (e) => e.key,
    );
    expect(mandatory.sort()).toEqual(['arrival_not_accepted', 'parcel_damaged']);

    // Email is never mandatory. Somebody who wants no mail gets no mail.
    for (const event of NOTIFICATION_EVENT_TYPES) {
      expect(isMandatory(event.key, 'email')).toBe(false);
    }
  });

  it('knows exactly two channels', () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(['in_app', 'email']);
  });

  it('does not label an event the SPA has never heard of as one it has', () => {
    // A label key for an event the server no longer emits is a dead translation
    // nobody will ever see fail.
    const known = new Set(NOTIFICATION_EVENT_TYPES.map((e) => e.key));
    const orphans = Object.keys(EVENT_LABEL_KEY).filter((key) => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it('translates every event the server can emit', () => {
    /**
     * The other direction, which was never checked and was badly broken:
     * TWENTY-FOUR of the thirty-six event types had no client label at all.
     *
     * `eventLabel` falls back to the raw event type, so the notification feed
     * badged them `wallet_request_completed`, `escrow_funded`,
     * `payment_reversed` — the database enum, in both languages — and the
     * preferences matrix fell through to the server's English `label`, leaving a
     * Hebrew reader with two-thirds of their notification settings in English.
     *
     * The fallbacks are still there and still correct as a safety net. What is
     * not acceptable is shipping with the safety net load-bearing.
     */
    const unlabelled = NOTIFICATION_EVENT_TYPES.filter((e) => !EVENT_LABEL_KEY[e.key]).map(
      (e) => e.key,
    );
    expect(unlabelled).toEqual([]);
  });
});
