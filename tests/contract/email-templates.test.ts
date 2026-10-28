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

    it(`${template} is the product's paper: its ink and its paper, the foil along its top and under its one button`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).not.toContain('#17202c');
      expect(html).toContain('#15130f');
      expect(html).toContain('#f3efe6');
      // The five hues of the foil: in the strip at the top and at the foot of each of the two buttons, three strips; a cell
      // names its hue twice, as an attribute and as a style, for the client that keeps only one of them.
      for (const hue of ['#ffa0a4', '#f8d376', '#85e9b6', '#6ed0ff', '#d3a6ff']) {
        expect(html.split(hue).length - 1).toBe(3 * 2);
      }
    });

    it(`${template} is made for a mail client: inline styles in tables, no web font, no script, nothing to fetch`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).not.toMatch(/<style|<link|<script|<img|@font-face|@import|url\(/i);
      expect(html).not.toMatch(/\sclass=/);
      // The button is a cell with a colour of its own, so a client that drops style attributes still draws it.
      expect(html).toMatch(/<td bgcolor="#15130f"[^>]*><a href="https:\/\/app\.example\.test/);
      // Fonts are the reader's own.
      expect(html).toMatch(/font:[^;"]*Georgia/);
      expect(html).not.toMatch(/IBM Plex|Frank Ruhl|Geist/);
    });

    it(`${template} has a kicker over each heading, and the Hebrew one is not spread out as capitals are`, () => {
      const { html } = renderEmail(template, { link: LINK });
      const hebrewHalf = html.slice(html.indexOf('lang="he"'), html.indexOf('lang="en"'));
      expect(hebrewHalf).toMatch(/letter-spacing:0;[^>]*>[֐-׿ ]+<\/p><h1/);
      const englishHalf = html.slice(html.indexOf('lang="en"'));
      expect(englishHalf).toMatch(/letter-spacing:0\.08em;[^>]*>[A-Z ]+<\/p><h1/);
    });
  }

  it('keeps the link readable left to right inside the Hebrew half', () => {
    const { html } = renderEmail('password_reset', { link: LINK });
    const hebrewHalf = html.slice(html.indexOf('lang="he"'), html.indexOf('lang="en"'));
    expect(hebrewHalf).toMatch(/<p dir="ltr"[^>]*>https:\/\/app\.example\.test/);
  });

  it('an update on the vault is one message in English, in the same paper', () => {
    const { html, text } = renderEmail('notification_event', {
      link: LINK,
      heading: 'Your item was received',
      message: 'Item SN-CL10-0005 was received.',
    });
    expect(html).not.toContain('lang="he"');
    expect(html).toContain('Your item was received');
    expect(html).toContain('#15130f');
    expect(text).toContain('Item SN-CL10-0005 was received.');
  });

  it('shows what an inbox shows after the subject, and not on the page', () => {
    const { html } = renderEmail('password_reset', { link: LINK });
    expect(html).toMatch(
      /<div style="display:none;[^"]*">[^<]*Somebody asked to reset the password/,
    );
  });

  it('escapes the link', () => {
    const { html } = renderEmail('email_verification', { link: 'https://x.test/?a="b"&c=<d>' });
    expect(html).not.toContain('"b"');
    expect(html).toContain('&quot;b&quot;');
    expect(html).toContain('&lt;d&gt;');
  });
});
