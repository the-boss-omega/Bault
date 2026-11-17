import { describe, it, expect } from 'vitest';
import { renderEmail } from '@bault/adapters';

const LINK = 'https://app.example.test/#/verify-email?token=abc123';

describe('the account emails a collector receives first', () => {
  for (const template of ['email_verification', 'password_reset']) {
    it(`${template} is one message, in English`, () => {
      const { html, text } = renderEmail(template, { link: LINK });
      expect(html.split('lang="en"').length - 1).toBe(1);
      expect(html).not.toMatch(/lang="he"|dir="rtl"/);
      expect(html).not.toMatch(/\p{Script=Hebrew}/u);
      expect(text).not.toMatch(/\p{Script=Hebrew}/u);
      expect(text.split(LINK).length - 1).toBe(1);
    });

    it(`${template} is the product's paper: its ink and its paper, the foil along its top and under its one button`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).not.toContain('#17202c');
      expect(html).toContain('#15130f');
      expect(html).toContain('#f3efe6');
      // The five hues of the foil: in the strip at the top and at the foot of the button, two strips; a cell names its
      // hue twice, as an attribute and as a style, for the client that keeps only one of them.
      for (const hue of ['#ffa0a4', '#f8d376', '#85e9b6', '#6ed0ff', '#d3a6ff']) {
        expect(html.split(hue).length - 1).toBe(2 * 2);
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

    it(`${template} has a kicker over its heading, in spaced capitals`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).toMatch(/letter-spacing:0\.08em;[^>]*>[A-Z ]+<\/p><h1/);
    });

    it(`${template} gives the link a button hides a line of its own`, () => {
      const { html } = renderEmail(template, { link: LINK });
      expect(html).toMatch(/<p style="clear:both;[^"]*">https:\/\/app\.example\.test/);
    });
  }

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

describe('the two-factor code mail', () => {
  it('puts the code where it is read first, in plain English, with nothing to click', () => {
    const { html, text } = renderEmail('mfa_email_code', { code: '204816', purpose: 'sign_in', minutes: '10' });
    expect(text).toContain('204816');
    expect(text).toMatch(/10 minutes/);
    expect(text).toMatch(/did not just try to sign in/i);
    expect(html).toContain('204816');
    expect(html).not.toContain('lang="he"');
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toMatch(/<style|<link|<script|<img|@font-face|@import|url\(/i);
    // The code is set in the reader's own monospace, large, so a six is not read as an eight.
    expect(html).toMatch(/<p[^>]*font:[^"]*monospace[^"]*"[^>]*>204816<\/p>/);
    expect(html).toContain('#15130f');
  });

  it('says what a settings code is for, and what to do when it was not asked for', () => {
    const { text } = renderEmail('mfa_email_code', { code: '000123', purpose: 'settings', minutes: '10' });
    expect(text).toContain('000123');
    expect(text).toMatch(/two-factor/i);
    expect(text).toMatch(/change your password/i);
  });

  it('escapes what it is given', () => {
    const { html } = renderEmail('mfa_email_code', { code: '<b>1</b>', purpose: 'sign_in', minutes: '10' });
    expect(html).not.toContain('<b>1</b>');
  });
});
