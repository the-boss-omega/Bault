import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  defaultEnabled,
  isMandatory,
} from '../../apps/api/src/modules/not/event-types';
import { defaultEmailEnabled, eventSubject } from '../../apps/worker/src/jobs/notification-events';
import { EVENT_LABEL_KEY } from '../../apps/web/src/shared/notifications';

describe('notification catalogue', () => {
  it('agrees with the worker about which events go out by email', () => {
    const disagreements = NOTIFICATION_EVENT_TYPES.filter(
      (event) => event.emailByDefault !== defaultEmailEnabled(event.key),
    ).map((event) => event.key);

    expect(disagreements).toEqual([]);
  });

  it('gives every event type a subject line', () => {
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
    expect(defaultEnabled('not_registered', 'in_app')).toBe(true);
    expect(defaultEnabled('not_registered', 'email')).toBe(false);
  });

  it('only makes in-app mandatory, and only for the two that carry bad news', () => {
    const mandatory = NOTIFICATION_EVENT_TYPES.filter((e) => isMandatory(e.key, 'in_app')).map(
      (e) => e.key,
    );
    expect(mandatory.sort()).toEqual(['arrival_not_accepted', 'parcel_damaged']);

    for (const event of NOTIFICATION_EVENT_TYPES) {
      expect(isMandatory(event.key, 'email')).toBe(false);
    }
  });

  it('knows exactly two channels', () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(['in_app', 'email']);
  });

  it('does not label an event the SPA has never heard of as one it has', () => {
    const known = new Set(NOTIFICATION_EVENT_TYPES.map((e) => e.key));
    const orphans = Object.keys(EVENT_LABEL_KEY).filter((key) => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it('translates every event the server can emit', () => {
    const unlabelled = NOTIFICATION_EVENT_TYPES.filter((e) => !EVENT_LABEL_KEY[e.key]).map(
      (e) => e.key,
    );
    expect(unlabelled).toEqual([]);
  });
});
