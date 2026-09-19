import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../packages/config/src/env';

/**
 * Boolean settings are read from strings, and the one an operator types to turn
 * something OFF is "false". `z.coerce.boolean()` turned that into `true` —
 * EXPOSE_API_DOCS=false served the API explorer. Every boolean flag must parse
 * the way a person reading the .env would expect.
 */
const shape = EnvSchema.innerType().shape;

describe('boolean environment flags', () => {
  for (const key of ['EXPOSE_API_DOCS', 'SMTP_SECURE'] as const) {
    it(`${key}: "false", "0", "no" and "off" mean off; "true", "1", "yes" and "on" mean on`, () => {
      for (const off of ['false', 'FALSE', '0', 'no', 'off', '']) expect(shape[key].parse(off)).toBe(false);
      for (const on of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) expect(shape[key].parse(on)).toBe(true);
    });
    it(`${key}: unset defaults to off`, () => {
      expect(shape[key].parse(undefined)).toBe(false);
    });
  }

  it('uses no truthiness-based coercion for any boolean flag', () => {
    for (const [key, field] of Object.entries(shape)) {
      // A z.coerce.boolean() field would accept "false" and return true.
      const parsed = (field as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse('false');
      if (parsed.success && typeof parsed.data === 'boolean') {
        expect(parsed.data, `${key} reads "false" as true`).toBe(false);
      }
    }
  });
});
