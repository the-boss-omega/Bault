import { describe, it, expect } from 'vitest';
import { renderEmail } from '@bault/adapters';

const HEBREW = /[֐-׿]/;
const LINK = 'https://app.example.test/#/verify-email?token=abc123';

describe('the account emails a collector receives first', () => {
  for (const template of ['email_verification', 'password_reset']) {
    it(`${template} reads in Hebrew first, then English, each in its own direction`, () => {
      const { html, text } = renderEmail(template, { link: LINK });
      const he = html.indexOf('lang="he"');
      const en = html.indexOf('lang="en"');
      expect(he).toBeGreaterThan(-1);
      expect(en).toBeGreaterThan(he);
      expect(html).toMatch(/lang="he" dir="rtl"/);
      expect(html).toMatch(/lang="en" dir="ltr"/);
      expect(text.split(LINK).length - 1).toBe(2);
      expect(text.slice(0, text.indexOf(LINK))).toMatch(HEBREW);
    });

    it(`${template} uses the product's ink and custody green, not the old navy`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).not.toContain('#17202c');
      expect(html).toContain('#0f5b4a');
      expect(html).toContain('#111318');
    });
  }

  it('keeps the link readable left to right inside the Hebrew half', () => {
    const { html } = renderEmail('password_reset', { link: LINK });
    const hebrewHalf = html.slice(html.indexOf('lang="he"'), html.indexOf('lang="en"'));
    expect(hebrewHalf).toMatch(/<p dir="ltr"[^>]*>https:\/\/app\.example\.test/);
  });

  it('escapes the link', () => {
    const { html } = renderEmail('email_verification', { link: 'https://x.test/?a="b"&c=<d>' });
    expect(html).not.toContain('"b"');
    expect(html).toContain('&quot;b&quot;');
    expect(html).toContain('&lt;d&gt;');
  });
});
