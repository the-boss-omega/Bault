import { describe, it, expect } from 'vitest';

const { RECORD_KINDS, recordKindsOf, recordKindsOfTheApp } =
  (await import('../../scripts/design-screens.mjs')) as unknown as {
    RECORD_KINDS: string[];
    recordKindsOf: (source: string) => string[];
    recordKindsOfTheApp: () => string[];
  };

/**
 * The audit looks at a list and, one by one, at what it opens: a guide's steps, a ticket, a parcel, a shipment. A
 * screen that is only ever captured as a list is never looked at as the record, and the steps of a guide were
 * drawn with every full stop at the wrong end of its line until one was opened.
 */
describe('the records the audit opens', () => {
  it('reads a kind from where the app opens it', () => {
    expect(
      recordKindsOf(`
        onOpen={(id) => openRecord('ticket', id)}
        onClick={() => openRecord(
          'item', item.id)}
        openRecord('ticket', row.id);
      `),
    ).toEqual(['item', 'ticket']);
  });

  it('knows every kind of record the app opens: a new kind is a screen to be reached, and to be listed', () => {
    expect(recordKindsOfTheApp()).toEqual([...RECORD_KINDS].sort());
  });
});
