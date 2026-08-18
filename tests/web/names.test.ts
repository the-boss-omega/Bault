import { describe, it, expect } from 'vitest';
import {
  NAME_PART_MAX,
  USERNAME_MAX,
  USERNAME_MIN,
  fullName,
  initialsFrom,
  isValidNamePart,
  isValidUsername,
  normalizeNamePart,
  normalizeUsername,
} from '../../apps/web/src/shared/names';

/**
 * The person-name and username rules, as the SPA enforces them.
 *
 * These cases are deliberately the same ones the API's `shared/names.ts` is held
 * to. The two modules are copies matched BY VALUE — neither imports the other —
 * so this file is what turns a silent drift between them into a failing test.
 */

describe('username: unique, permanent, normalized', () => {
  it('normalizes to a single canonical form', () => {
    // "Red", " red " and "RED" must be one account, not three.
    expect(normalizeUsername('Red')).toBe('red');
    expect(normalizeUsername('  red  ')).toBe('red');
    expect(normalizeUsername('RED')).toBe('red');
  });

  it('accepts the documented alphabet', () => {
    for (const name of ['red', 'golden', 'ana.maria', 'user_42', 'a-b-c']) {
      expect(isValidUsername(name)).toBe(true);
    }
  });

  it('rejects anything outside it', () => {
    for (const name of ['ab', 'a'.repeat(USERNAME_MAX + 1), 'has space', 'Upper', 'mail@host', 'שם']) {
      expect(isValidUsername(name)).toBe(false);
    }
  });

  it('enforces the published length bounds exactly', () => {
    expect(isValidUsername('a'.repeat(USERNAME_MIN - 1))).toBe(false);
    expect(isValidUsername('a'.repeat(USERNAME_MIN))).toBe(true);
    expect(isValidUsername('a'.repeat(USERNAME_MAX))).toBe(true);
    expect(isValidUsername('a'.repeat(USERNAME_MAX + 1))).toBe(false);
  });
});

describe('name parts: first and last, validated', () => {
  it('collapses internal whitespace and trims', () => {
    expect(normalizeNamePart('  Ana   Maria  ')).toBe('Ana Maria');
  });

  it('accepts real names in any script', () => {
    for (const part of ['Red', 'Ashwood', 'אנה', 'محمد', 'Ferreira-Silva', "O'Brien", 'van der Berg']) {
      expect(isValidNamePart(normalizeNamePart(part))).toBe(true);
    }
  });

  it('rejects empty, over-long, and markup-bearing names', () => {
    expect(isValidNamePart('')).toBe(false);
    expect(isValidNamePart('a'.repeat(NAME_PART_MAX + 1))).toBe(false);
    expect(isValidNamePart('<script>')).toBe(false);
    expect(isValidNamePart('a>b')).toBe(false);
  });

  it('rejects control characters that could smuggle a line break into a label', () => {
    // Built from code points rather than written literally, so this source file
    // contains no control characters of its own.
    const control = (code: number) => 'Red' + String.fromCodePoint(code) + 'Ashwood';
    expect(isValidNamePart(control(0x0a))).toBe(false); // line feed
    expect(isValidNamePart(control(0x0d))).toBe(false); // carriage return
    expect(isValidNamePart(control(0x00))).toBe(false); // NUL
    expect(isValidNamePart(control(0x1b))).toBe(false); // ESC (terminal escapes)
    expect(isValidNamePart(control(0x1f))).toBe(false); // last control code point
    // U+0020 is the first NON-control code point and is perfectly ordinary.
    expect(isValidNamePart(control(0x20))).toBe(true);
  });
});

describe('full name is derived, never stored', () => {
  it('joins the two parts with a single space', () => {
    expect(fullName('Red', 'Ashwood')).toBe('Red Ashwood');
  });

  it('degrades gracefully when a part is missing', () => {
    // A migrated account may legitimately have no last name yet (see the 0004
    // migration rule); it must render as the first name, not "Red undefined".
    expect(fullName('Ana Maria van der Berg', null)).toBe('Ana Maria van der Berg');
    expect(fullName(null, 'Ashwood')).toBe('Ashwood');
    expect(fullName(null, null)).toBe('');
    expect(fullName(undefined, undefined)).toBe('');
  });

  it('trims each part before joining', () => {
    expect(fullName('  Red  ', '  Ashwood ')).toBe('Red Ashwood');
  });
});

describe('avatar initials', () => {
  it('uses the two name parts when they exist', () => {
    expect(initialsFrom('Red', 'Ashwood', 'red@bault.dev')).toBe('RA');
  });

  it('falls back to the email local part when there is no name', () => {
    expect(initialsFrom(null, null, 'ana.maria@bault.dev')).toBe('AM');
  });

  it('never returns an empty string', () => {
    expect(initialsFrom(null, null, null)).toBe('BA');
    expect(initialsFrom('', '', '')).toBe('BA');
  });
});
