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
  kicker: string;
  heading: string;
  body: string;
  action: string;
  footer: string;
}

const PAGE = '#e9e6dd';
const PAPER = '#f3efe6';
const BRIGHT = '#fffdf8';
const INK = '#15130f';
const INK_2 = '#403d36';
const INK_3 = '#4b4742';
const RULE = '#d6d0c2';
const FOIL = ['#ffa0a4', '#f8d376', '#85e9b6', '#6ed0ff', '#d3a6ff'];
const SANS = "-apple-system,'Segoe UI',Arial,'Helvetica Neue',sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

function actionText(copy: ActionCopy, link: string): string {
  return [copy.kicker, copy.heading, '', copy.body, '', link, '', copy.footer].join('\n');
}

function foil(height: number): string {
  const cells = FOIL.map(
    (hue) =>
      `<td width="20%" height="${height}" bgcolor="${hue}" style="background:${hue};height:${height}px;font-size:0;line-height:0">&nbsp;</td>`,
  ).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cells}</tr></table>`;
}

function button(label: string, href: string): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="border-collapse:separate">`,
    `<tr><td bgcolor="${INK}" style="background:${INK};border-radius:6px 6px 0 0"><a href="${href}" style="display:inline-block;padding:13px 26px 12px;font:600 15px/1.2 ${SANS};color:${BRIGHT};text-decoration:none">${escapeHtml(label)}</a></td></tr>`,
    `<tr><td style="font-size:0;line-height:0;border-radius:0 0 6px 6px;overflow:hidden">${foil(3)}</td></tr>`,
    '</table>',
  ].join('');
}

function actionSection(copy: ActionCopy, link: string): string {
  const href = escapeHtml(link);
  return [
    `<div lang="en" style="text-align:left">`,
    `<p style="margin:0 0 10px;font:600 11px/1.3 ${MONO};letter-spacing:0.08em;color:${INK_3}">${escapeHtml(copy.kicker)}</p>`,
    `<h1 style="margin:0 0 14px;font:600 26px/1.25 ${SERIF};color:${INK}">${escapeHtml(copy.heading)}</h1>`,
    `<p style="margin:0 0 24px;font:400 15px/1.6 ${SANS};color:${INK_2}">${escapeHtml(copy.body)}</p>`,
    button(copy.action, href),
    `<p style="clear:both;margin:0;padding:20px 0 0;font:12px/1.6 ${MONO};color:${INK_3};text-align:left;word-break:break-all">${href}</p>`,
    `<p style="margin:14px 0 0;font:400 13px/1.55 ${SANS};color:${INK_3}">${escapeHtml(copy.footer)}</p>`,
    '</div>',
  ].join('');
}

function frame(section: string, preheader: string): string {
  return [
    `<div style="margin:0;padding:0;background:${PAGE}">`,
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE};opacity:0">${escapeHtml(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:28px 12px">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};border:1px solid ${RULE};border-radius:4px;border-collapse:separate">`,
    `<tr><td style="border-radius:4px 4px 0 0;overflow:hidden">${foil(4)}</td></tr>`,
    `<tr><td style="padding:26px 32px 0"><span style="font:700 22px/1 ${SERIF};color:${INK}">Card Embassy</span></td></tr>`,
    `<tr><td style="padding:22px 32px 28px">${section}</td></tr>`,
    `<tr><td style="padding:16px 32px 22px;border-top:1px solid ${RULE};font:11px/1.6 ${MONO};letter-spacing:0.04em;color:${INK_3}">Card Embassy — collectibles vault and marketplace. Facilities in New Jersey and Delaware. Settled in USD.</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</div>',
  ].join('\n');
}

interface CodeCopy {
  kicker: string;
  heading: string;
  body: string;
  footer: string;
}

function codeEmail(copy: CodeCopy, code: string): RenderedEmail {
  const html = [
    '<div lang="en" dir="ltr" style="text-align:left">',
    `<p style="margin:0 0 10px;font:600 11px/1.3 ${MONO};letter-spacing:0.08em;color:${INK_3}">${escapeHtml(copy.kicker)}</p>`,
    `<h1 style="margin:0 0 14px;font:600 26px/1.25 ${SERIF};color:${INK}">${escapeHtml(copy.heading)}</h1>`,
    `<p style="margin:0 0 20px;font:400 15px/1.6 ${SANS};color:${INK_2}">${escapeHtml(copy.body)}</p>`,
    `<p style="display:inline-block;margin:0 0 20px;padding:14px 20px;font:700 32px/1.1 ${MONO};letter-spacing:0.2em;color:${INK};background:${BRIGHT};border:1px solid ${RULE};border-radius:4px">${escapeHtml(code)}</p>`,
    `<p style="margin:0;font:400 13px/1.55 ${SANS};color:${INK_3}">${escapeHtml(copy.footer)}</p>`,
    '</div>',
  ].join('');
  return {
    text: [copy.kicker, copy.heading, '', copy.body, '', code, '', copy.footer].join('\n'),
    html: frame(html, copy.body),
  };
}

function actionEmail(copy: ActionCopy, link: string): RenderedEmail {
  return {
    text: actionText(copy, link),
    html: frame(actionSection(copy, link), copy.body),
  };
}

export function renderEmail(template: string, variables: Record<string, string>): RenderedEmail {
  const link = variables.link ?? '';
  switch (template) {
    case 'email_verification':
      return actionEmail(
        {
          kicker: 'ADDRESS CONFIRMATION',
          heading: 'Confirm your email address',
          body: 'Your Card Embassy account has been created and is waiting on one thing: confirming this address. Follow the link below to activate it and sign in.',
          action: 'Confirm email address',
          footer: 'The link is valid for 24 hours and can be used once. If you did not create a Card Embassy account, ignore this message and nothing will happen.',
        },
        link,
      );
    case 'password_reset':
      return actionEmail(
        {
          kicker: 'PASSWORD RESET',
          heading: 'Reset your password',
          body: 'Somebody asked to reset the password on this Card Embassy account. Follow the link below to choose a new one.',
          action: 'Choose a new password',
          footer: 'The link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message — your current password stays in force.',
        },
        link,
      );
    case 'email_change':
      return actionEmail(
        {
          kicker: 'CONFIRM YOUR NEW ADDRESS',
          heading: 'Confirm your new email address',
          body: 'Somebody signed in to a Card Embassy account asked to use this address for it from now on. Follow the link below to confirm it. Until you do, the account keeps its old address.',
          action: 'Confirm new address',
          footer: 'The link is valid for 24 hours and can be used once. Opening it signs the account out everywhere else. If you did not ask for this, ignore this message and nothing will change.',
        },
        link,
      );
    case 'email_change_notice': {
      const to = variables.newAddress ?? 'a new address';
      const support = variables.support ? ` at ${variables.support}` : '';
      const action = variables.support ? 'Write to support' : 'Contact support';
      return actionEmail(
        variables.stage === 'changed'
          ? {
              kicker: 'EMAIL ADDRESS CHANGED',
              heading: 'Your email address was changed',
              body: `The email address on your Card Embassy account is now ${to}. Mail about the account goes there from now on, and the account was signed out everywhere else.`,
              action,
              footer: `If this was not you, contact Card Embassy support at once${support}: this address no longer signs in to the account.`,
            }
          : {
              kicker: 'EMAIL CHANGE REQUESTED',
              heading: 'A change of email address was asked for',
              body: `Somebody asked to change the email address on your Card Embassy account to ${to}. Nothing changes until the link sent to the new address is opened, and that link stops working after 24 hours.`,
              action,
              footer: `If this was not you, sign in and cancel it under Profile → Details, change your password, and contact Card Embassy support${support}. If it was you, there is nothing to do here.`,
            },
        link,
      );
    }
    case 'mfa_email_code': {
      const minutes = variables.minutes ?? '10';
      const settings = variables.purpose === 'settings';
      return codeEmail(
        settings
          ? {
              kicker: 'CONFIRMATION CODE',
              heading: 'Confirm a change to two-factor sign-in',
              body: 'Enter this code in Card Embassy to confirm the change you are making to how you sign in.',
              footer: `It works once, for the next ${minutes} minutes. If you did not ask for it, somebody may be changing your two-factor sign-in: change your password. Card Embassy never asks for this code by phone or email.`,
            }
          : {
              kicker: 'SIGN-IN CODE',
              heading: 'Your sign-in code',
              body: 'Enter this code on the Card Embassy sign-in page to finish signing in.',
              footer: `It works once, for the next ${minutes} minutes. If more than one email came, use the code in the newest. If you did not just try to sign in, somebody knows your password: change it, and do not give this code to anyone. Card Embassy never asks for it by phone or email.`,
            },
        variables.code ?? '',
      );
    }
    case 'notification_event':
      return actionEmail(
        {
          kicker: 'FROM YOUR VAULT',
          heading: variables.heading ?? 'An update on your vault',
          body: variables.message ?? '',
          action: 'Open Card Embassy',
          footer:
            variables.footer ??
            'You are receiving this because email is switched on for this kind of update. You can turn it off, per event or all at once, in Notifications → Preferences.',
        },
        link,
      );
    default:
      throw new Error(`There is no email template named ${template}`);
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

export const SMTP_TIMEOUTS_MS = { connection: 15_000, greeting: 15_000, socket: 60_000 } as const;

export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      connectionTimeout: SMTP_TIMEOUTS_MS.connection,
      greetingTimeout: SMTP_TIMEOUTS_MS.greeting,
      socketTimeout: SMTP_TIMEOUTS_MS.socket,
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
