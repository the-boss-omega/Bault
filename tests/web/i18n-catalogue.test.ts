import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
    const rendered = t('wallet.request.submittedNext', 'en', { code: 'WR-TEST0001', amount: '$1.00' });
    expect(rendered).toContain('WR-TEST0001');
    expect(rendered).not.toContain('{code}');
  });

  it('leaves an unmatched placeholder verbatim rather than printing "undefined"', () => {
    expect(t('wallet.request.submittedNext', 'en', {})).toContain('{code}');
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
    expect(hasMessage('ss.tracking.searchPlaceholder')).toBe(false);
    expect(hasMessage('ss.tracking.col.username')).toBe(false);
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

describe('every catalogued string is used', () => {
  const root = resolve(__dirname, '../../apps/web/src');

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it('has no key that no screen asks for, counting a key built from a literal prefix as used', () => {
    const catalogue = readFileSync(join(root, 'shared/i18n.tsx'), 'utf8');
    const start = catalogue.indexOf('const en = {');
    const end = catalogue.indexOf('} as const;', start);
    expect(start).toBeGreaterThan(-1);
    const code = sources(root)
      .map((path) => {
        const text = readFileSync(path, 'utf8');
        return path.endsWith(join('shared', 'i18n.tsx')) ? text.slice(0, start) + text.slice(end) : text;
      })
      .join('\n');

    const literals = new Set<string>();
    for (const m of code.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) literals.add(m[1] ?? m[2] ?? '');
    for (const m of code.matchAll(/`([a-zA-Z][\w.-]*)`/g)) literals.add(m[1]!);
    const prefixes = new Set<string>();
    for (const m of code.matchAll(/`([^`$]*)\$\{/g)) if (m[1]!.includes('.')) prefixes.add(m[1]!);
    for (const literal of literals) if (/^[a-zA-Z][\w-]*(\.[\w-]+)*\.$/.test(literal)) prefixes.add(literal);
    for (const m of code.matchAll(/`\$\{([^}]*)\}\./g)) {
      for (const stem of m[1]!.matchAll(/'([^'\\\n]+)'|"([^"\\\n]+)"/g)) prefixes.add(`${stem[1] ?? stem[2]}.`);
    }

    const unused = MESSAGE_KEYS.filter(
      (key) => !literals.has(key) && ![...prefixes].some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });
});
