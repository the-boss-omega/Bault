import { createTransport, type Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<{ providerRef: string }>;
}

export interface RenderedEmail {
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ActionCopy {
  /** What the message is, in a few capital letters, over its heading. */
  kicker: string;
  heading: string;
  body: string;
  action: string;
  footer: string;
}

/*
 * The messages are written the way the product is: a slip of paper, with the foil along its top edge and on the
 * foot of the one button. Everything is inline (a mail client keeps what a style attribute says, and little else),
 * laid out in tables (Outlook lays out nothing else), and set in the fonts the reader's own device has: no web font
 * is loaded, so none is waited for, and none is missing. The hues are the foil of theme.css and the inks of its paper,
 * written as the hex a mail client reads (the lint's colour maths made them from the oklch the stylesheet has).
 */
const PAGE = '#e9e6dd';
const PAPER = '#f3efe6';
const BRIGHT = '#fffdf8';
const INK = '#15130f';
const INK_2 = '#403d36';
const INK_3 = '#4b4742';
const RULE = '#d6d0c2';
const TEAR = '#b9b19f';
const FOIL = ['#ffa0a4', '#f8d376', '#85e9b6', '#6ed0ff', '#d3a6ff'];
const SANS = "-apple-system,'Segoe UI',Arial,'Helvetica Neue',sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

function actionText(copy: ActionCopy, link: string): string {
  return [copy.kicker, copy.heading, '', copy.body, '', link, '', copy.footer].join('\n');
}

/** A strip of the five foil hues, `height` px thick: a row of cells, because a gradient is not something a mail client promises. */
function foil(height: number): string {
  const cells = FOIL.map(
    (hue) =>
      `<td width="20%" height="${height}" bgcolor="${hue}" style="background:${hue};height:${height}px;font-size:0;line-height:0">&nbsp;</td>`,
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cells}</tr></table>`;
}

/** The one button: ink on the paper, its foot a strip of foil. A cell with a colour of its own, so that a client that drops styles still draws it. */
function button(label: string, href: string, align: 'left' | 'right'): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="border-collapse:separate">`,
    `<tr><td bgcolor="${INK}" style="background:${INK};border-radius:6px 6px 0 0"><a href="${href}" style="display:inline-block;padding:13px 26px 12px;font:600 15px/1.2 ${SANS};color:${BRIGHT};text-decoration:none">${escapeHtml(label)}</a></td></tr>`,
    `<tr><td style="font-size:0;line-height:0;border-radius:0 0 6px 6px;overflow:hidden">${foil(3)}</td></tr>`,
    '</table>',
  ].join('');
}

function actionSection(copy: ActionCopy, link: string, lang: 'he' | 'en'): string {
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const align = lang === 'he' ? 'right' : 'left';
  const href = escapeHtml(link);
  return [
    `<div lang="${lang}" dir="${dir}" style="text-align:${align}">`,
    // Spaced capitals are a Latin habit: Hebrew has no capitals, and spread out it is hard to read.
    `<p style="margin:0 0 10px;font:600 11px/1.3 ${MONO};letter-spacing:${lang === 'he' ? '0' : '0.08em'};color:${INK_3}">${escapeHtml(copy.kicker)}</p>`,
    `<h1 style="margin:0 0 14px;font:600 26px/1.25 ${SERIF};color:${INK}">${escapeHtml(copy.heading)}</h1>`,
    `<p style="margin:0 0 24px;font:400 15px/1.6 ${SANS};color:${INK_2}">${escapeHtml(copy.body)}</p>`,
    button(copy.action, href, align),
    // The link a button hides, for the client that does not draw the button: its own line, read left to right in either language.
    `<p dir="ltr" style="clear:both;margin:0;padding:20px 0 0;font:12px/1.6 ${MONO};color:${INK_3};text-align:${align};word-break:break-all">${href}</p>`,
    `<p style="margin:14px 0 0;font:400 13px/1.55 ${SANS};color:${INK_3}">${escapeHtml(copy.footer)}</p>`,
    '</div>',
  ].join('');
}

function frame(sections: string[], preheader: string): string {
  const tear = `</td></tr><tr><td style="padding:0 32px"><div style="height:0;font-size:0;line-height:0;border-top:1px dashed ${TEAR}">&nbsp;</div></td></tr><tr><td style="padding:26px 32px 28px">`;
  return [
    `<div style="margin:0;padding:0;background:${PAGE}">`,
    // What an inbox shows after the subject.
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE};opacity:0">${escapeHtml(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:28px 12px">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};border:1px solid ${RULE};border-radius:4px;border-collapse:separate">`,
    `<tr><td style="border-radius:4px 4px 0 0;overflow:hidden">${foil(4)}</td></tr>`,
    `<tr><td style="padding:26px 32px 0"><span style="font:700 22px/1 ${SERIF};color:${INK}">Bault</span></td></tr>`,
    `<tr><td style="padding:22px 32px 28px">${sections.join(tear)}</td></tr>`,
    `<tr><td dir="ltr" style="padding:16px 32px 22px;border-top:1px solid ${RULE};font:11px/1.6 ${MONO};letter-spacing:0.04em;color:${INK_3}">Bault — collectibles vault and marketplace. Facilities in New Jersey and Delaware. Settled in USD.</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</div>',
  ].join('\n');
}

function actionEmail(copy: ActionCopy, link: string): RenderedEmail {
  return {
    text: actionText(copy, link),
    html: frame([actionSection(copy, link, 'en')], copy.body),
  };
}

function bilingualEmail(he: ActionCopy, en: ActionCopy, link: string): RenderedEmail {
  return {
    text: [actionText(he, link), '', '—', '', actionText(en, link)].join('\n'),
    html: frame(
      [actionSection(he, link, 'he'), actionSection(en, link, 'en')],
      `${he.body} ${en.body}`,
    ),
  };
}

export function renderEmail(template: string, variables: Record<string, string>): RenderedEmail {
  const link = variables.link ?? '';
  switch (template) {
    case 'email_verification':
      return bilingualEmail(
        {
          kicker: 'אימות כתובת',
          heading: 'אימות כתובת האימייל',
          body: 'החשבון שלך ב־Bault נפתח, ונשאר רק לאמת את הכתובת הזו. לחץ על הקישור כדי להפעיל את החשבון ולהתחבר.',
          action: 'אימות הכתובת',
          footer: 'הקישור תקף ל־24 שעות ולשימוש אחד. אם לא פתחת חשבון ב־Bault, התעלם מההודעה ולא יקרה דבר.',
        },
        {
          kicker: 'ADDRESS CONFIRMATION',
          heading: 'Confirm your email address',
          body: 'Your Bault account has been created and is waiting on one thing: confirming this address. Follow the link below to activate it and sign in.',
          action: 'Confirm email address',
          footer: 'The link is valid for 24 hours and can be used once. If you did not create a Bault account, ignore this message and nothing will happen.',
        },
        link,
      );
    case 'password_reset':
      return bilingualEmail(
        {
          kicker: 'איפוס סיסמה',
          heading: 'איפוס הסיסמה',
          body: 'מישהו ביקש לאפס את הסיסמה של חשבון Bault הזה. לחץ על הקישור כדי לבחור סיסמה חדשה.',
          action: 'בחירת סיסמה חדשה',
          footer: 'הקישור תקף לשעה אחת ולשימוש אחד. אם לא ביקשת זאת, התעלם מההודעה — הסיסמה הנוכחית נשארת בתוקף.',
        },
        {
          kicker: 'PASSWORD RESET',
          heading: 'Reset your password',
          body: 'Somebody asked to reset the password on this Bault account. Follow the link below to choose a new one.',
          action: 'Choose a new password',
          footer: 'The link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message — your current password stays in force.',
        },
        link,
      );
    case 'notification_event':
      return actionEmail(
        {
          kicker: 'FROM YOUR VAULT',
          heading: variables.heading ?? 'An update on your vault',
          body: variables.message ?? '',
          action: 'Open Bault',
          footer:
            variables.footer ??
            'You are receiving this because email is switched on for this kind of update. You can turn it off, per event or all at once, in Notifications → Preferences.',
        },
        link,
      );
    default: {
      const lines = Object.entries(variables).map(([k, v]) => `${k}: ${v}`);
      const text = lines.join('\n');
      const html = `<pre style="font-family:ui-monospace,monospace">${escapeHtml(text)}</pre>`;
      return { text, html };
    }
  }
}

export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<{ providerRef: string }> {
    // eslint-disable-next-line no-console
    console.log(`[email] to=${message.to} template=${message.template}`, message.variables);
    return { providerRef: `console_${Date.now()}` };
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
  from: string;
}

export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      auth: { user: config.user, pass: config.password },
    });
  }

  async send(message: EmailMessage): Promise<{ providerRef: string }> {
    const { text, html } = renderEmail(message.template, message.variables);
    const info = await this.transport.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text,
      html,
    });
    return { providerRef: info.messageId ?? `smtp_${Date.now()}` };
  }
}
