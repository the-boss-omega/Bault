import { describe, it, expect } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, MESSAGE_KEYS, hasMessage, t } from '../../apps/web/src/shared/i18n';

/**
 * The message catalogues.
 *
 * Two things are checked here that nothing else can catch:
 *
 *  1. TRANSLATION COVERAGE. `MessageKey` is derived from the Hebrew catalogue and
 *     the English one is typed as a total map over it, so a MISSING English key
 *     fails the build. What the type system cannot see is a key that exists but
 *     was left as the Hebrew string, or an English string that silently dropped a
 *     `{placeholder}` the caller passes.
 *
 *  2. BRAND. No user-facing string may say "ShipMyCards". The one place that name
 *     legitimately appears in the product is the FAQ's attribution of its quoted
 *     third-party source (see `faq-legal.test.ts`), which is not in this
 *     catalogue.
 */

describe('message catalogues', () => {
  it('exposes exactly the two supported locales, Hebrew first', () => {
    expect([...LOCALES]).toEqual(['he', 'en']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('resolves a known key in both locales', () => {
    for (const locale of LOCALES) {
      expect(t('app.title', locale)).toBeTruthy();
      expect(t('nav.primary', locale)).toBeTruthy();
    }
  });

  it('translates the same key differently per locale where it should', () => {
    expect(t('nav.primary', 'he')).not.toBe(t('nav.primary', 'en'));
    expect(t('wallet.tab.requests', 'he')).not.toBe(t('wallet.tab.requests', 'en'));
  });

  it('substitutes placeholders in both locales', () => {
    for (const locale of LOCALES) {
      const rendered = t('wallet.request.submitted', locale, { code: 'WR-TEST0001' });
      expect(rendered).toContain('WR-TEST0001');
      expect(rendered).not.toContain('{code}');
    }
  });

  it('leaves an unmatched placeholder verbatim rather than printing "undefined"', () => {
    expect(t('wallet.request.submitted', 'en', {})).toContain('{code}');
  });

  it('reports unknown keys as absent, so callers can omit rather than print them', () => {
    expect(hasMessage('nav.primary')).toBe(true);
    expect(hasMessage('this.key.does.not.exist')).toBe(false);
  });
});

describe('retired keys are really gone', () => {
  it('has no pin/unpin strings — the rail is not pinnable', () => {
    expect(hasMessage('nav.pin')).toBe(false);
    expect(hasMessage('nav.unpin')).toBe(false);
  });

  it('has no display-name strings — a name is two explicit fields', () => {
    for (const key of [
      'profile.displayNameLabel',
      'profile.displayNameSubtitle',
      'profile.displayNamePlaceholder',
    ]) {
      expect(hasMessage(key), `${key} should be gone`).toBe(false);
    }
  });

  it('has no intake-ID strings in the customer-facing surface', () => {
    expect(hasMessage('profile.details.intakeId')).toBe(false);
    expect(hasMessage('warehouse.intake.ownerIntakeId')).toBe(false);
    // The one surviving mention is the admin troubleshooting tooltip, which is
    // deliberate and explicitly labelled as historical.
    expect(hasMessage('admin.users.legacyIntakeIdTitle')).toBe(true);
  });

  it('replaced the tracking-by-id strings with list strings', () => {
    expect(hasMessage('ss.tracking.idLabel')).toBe(false);
    expect(hasMessage('ss.tracking.idPlaceholder')).toBe(false);
    expect(hasMessage('ss.tracking.searchPlaceholder')).toBe(true);
    expect(hasMessage('ss.tracking.col.username')).toBe(true);
  });
});

describe('brand', () => {
  /**
   * NOTHING may name Ship My Cards any more.
   *
   * There used to be an allowance of three keys: the FAQ tab carried a
   * catalogue of answers copied verbatim from shipmycards.com, and those
   * strings were its attribution. The FAQ is Bault's own now — its answers
   * describe Bault's own storage terms, fees and flows — so the quotation, and
   * with it the reason to name another company anywhere in the product, is gone.
   */
  it('says Bault, never ShipMyCards, in every catalogued string', () => {
    expect(MESSAGE_KEYS.length).toBeGreaterThan(100); // the whole catalogue, not a sample

    const offenders: string[] = [];
    for (const key of MESSAGE_KEYS) {
      for (const locale of LOCALES) {
        const value = t(key, locale);
        if (/ship\s*my\s*cards/i.test(value)) offenders.push(`${locale}:${key} = ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no untranslated English string left as its Hebrew original', () => {
    // A key whose two locales are byte-identical is usually fine (a brand name,
    // a currency code, "PayPal"), but a LONG identical string is almost always a
    // translation that was never done.
    const suspicious = MESSAGE_KEYS.filter((key) => {
      const he = t(key, 'he');
      const en = t(key, 'en');
      return he === en && he.length > 25 && /[֐-׿]/.test(he);
    });
    expect(suspicious).toEqual([]);
  });

  it('keeps the same placeholders in both locales', () => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    const mismatched = MESSAGE_KEYS.filter(
      (key) => placeholders(t(key, 'he')).join() !== placeholders(t(key, 'en')).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('names Bault in the strings that carry the product name', () => {
    for (const locale of LOCALES) {
      expect(t('app.title', locale)).toContain('Bault');
      expect(t('error.unreachable', locale)).toContain('Bault');
    }
  });
});
