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
  heading: string;
  body: string;
  action: string;
  footer: string;
}

const INK = '#111318';
const BODY = '#2a2d33';
const MUTED = '#676c74';
const CUSTODY = '#0f5b4a';
const LINE = '#dcded9';
const FONT = "'IBM Plex Sans','IBM Plex Sans Hebrew',-apple-system,'Segoe UI',Arial,sans-serif";

function actionText(copy: ActionCopy, link: string): string {
  return [copy.heading, '', copy.body, '', link, '', copy.footer].join('\n');
}

function actionSection(copy: ActionCopy, link: string, lang: 'he' | 'en'): string {
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  const align = lang === 'he' ? 'right' : 'left';
  const href = escapeHtml(link);
  return [
    `  <div lang="${lang}" dir="${dir}" style="text-align:${align}">`,
    `    <h1 style="font-size:20px;line-height:1.35;font-weight:600;margin:0 0 16px;color:${INK}">${escapeHtml(copy.heading)}</h1>`,
    `    <p style="margin:0 0 20px;color:${BODY}">${escapeHtml(copy.body)}</p>`,
    `    <p style="margin:0 0 20px"><a href="${href}" style="background:${CUSTODY};color:#ffffff;padding:10px 18px;border-radius:3px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(copy.action)}</a></p>`,
    `    <p dir="ltr" style="margin:0 0 20px;font-size:13px;color:${MUTED};text-align:${align};word-break:break-all">${href}</p>`,
    `    <p style="margin:0;font-size:13px;color:${MUTED}">${escapeHtml(copy.footer)}</p>`,
    '  </div>',
  ].join('\n');
}

function frame(sections: string[]): string {
  return [
    `<div style="font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY};max-width:560px;margin:0 auto;padding:24px 16px">`,
    `  <p style="font-family:'Frank Ruhl Libre',Georgia,serif;font-size:20px;font-weight:600;margin:0 0 24px;color:${INK}">Bault</p>`,
    sections.join(`\n  <hr style="border:0;border-top:1px solid ${LINE};margin:32px 0">\n`),
    '</div>',
  ].join('\n');
}

function actionEmail(copy: ActionCopy, link: string): RenderedEmail {
  return { text: actionText(copy, link), html: frame([actionSection(copy, link, 'en')]) };
}

function bilingualEmail(he: ActionCopy, en: ActionCopy, link: string): RenderedEmail {
  return {
    text: [actionText(he, link), '', '—', '', actionText(en, link)].join('\n'),
    html: frame([actionSection(he, link, 'he'), actionSection(en, link, 'en')]),
  };
}

export function renderEmail(template: string, variables: Record<string, string>): RenderedEmail {
  const link = variables.link ?? '';
  switch (template) {
    case 'email_verification':
      return bilingualEmail(
        {
          heading: 'אימות כתובת האימייל',
          body: 'החשבון שלך ב־Bault נפתח, ונשאר רק לאמת את הכתובת הזו. לחץ על הקישור כדי להפעיל את החשבון ולהתחבר.',
          action: 'אימות הכתובת',
          footer: 'הקישור תקף ל־24 שעות ולשימוש אחד. אם לא פתחת חשבון ב־Bault, התעלם מההודעה ולא יקרה דבר.',
        },
        {
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
          heading: 'איפוס הסיסמה',
          body: 'מישהו ביקש לאפס את הסיסמה של חשבון Bault הזה. לחץ על הקישור כדי לבחור סיסמה חדשה.',
          action: 'בחירת סיסמה חדשה',
          footer: 'הקישור תקף לשעה אחת ולשימוש אחד. אם לא ביקשת זאת, התעלם מההודעה — הסיסמה הנוכחית נשארת בתוקף.',
        },
        {
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
