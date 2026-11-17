import { describe, it, expect } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, MESSAGE_KEYS, hasMessage, t } from '../../apps/web/src/shared/i18n';

describe('message catalogues', () => {
  it('has one language, English', () => {
    expect([...LOCALES]).toEqual(['en']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('resolves a known key', () => {
    expect(t('app.title')).toBeTruthy();
    expect(t('nav.primary')).toBeTruthy();
  });

  it('substitutes placeholders', () => {
    const rendered = t('wallet.request.submitted', 'en', { code: 'WR-TEST0001' });
    expect(rendered).toContain('WR-TEST0001');
    expect(rendered).not.toContain('{code}');
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
  it('has no strings for choosing a language — there is one', () => {
    for (const key of ['app.switchLanguage', 'app.switchLanguageLabel', 'menu.language', 'menu.languageCurrent']) {
      expect(hasMessage(key), `${key} should be gone`).toBe(false);
    }
  });

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
  it('says Card Embassy, never Bault or ShipMyCards, in every catalogued string', () => {
    expect(MESSAGE_KEYS.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const key of MESSAGE_KEYS) {
      const value = t(key);
      if (/ship\s*my\s*cards|\bbault\b/i.test(value)) offenders.push(`${key} = ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it('is written in English: no string in the catalogue is in Hebrew', () => {
    expect(MESSAGE_KEYS.filter((key) => /\p{Script=Hebrew}/u.test(t(key)))).toEqual([]);
  });

  it('names Card Embassy in the strings that carry the product name', () => {
    expect(t('app.title')).toContain('Card Embassy');
    expect(t('error.unreachable')).toContain('Card Embassy');
  });
});
