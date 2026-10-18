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

function actionEmail(input: {
  heading: string;
  body: string;
  action: string;
  link: string;
  footer: string;
}): RenderedEmail {
  const text = [input.heading, '', input.body, '', input.link, '', input.footer].join('\n');
  const href = escapeHtml(input.link);
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#17202c">',
    `  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(input.heading)}</h1>`,
    `  <p style="margin:0 0 20px">${escapeHtml(input.body)}</p>`,
    `  <p style="margin:0 0 20px"><a href="${href}" style="background:#17202c;color:#fff;padding:10px 18px;border-radius:3px;text-decoration:none;display:inline-block">${escapeHtml(input.action)}</a></p>`,
    `  <p style="margin:0 0 20px;font-size:13px;color:#6e7887">${escapeHtml(input.link)}</p>`,
    `  <p style="margin:0;font-size:13px;color:#6e7887">${escapeHtml(input.footer)}</p>`,
    '</div>',
  ].join('\n');
  return { text, html };
}

export function renderEmail(template: string, variables: Record<string, string>): RenderedEmail {
  const link = variables.link ?? '';
  switch (template) {
    case 'email_verification':
      return actionEmail({
        heading: 'Confirm your email address',
        body: 'Your Bault account has been created and is waiting on one thing: confirming this address. Follow the link below to activate it and sign in.',
        action: 'Confirm email address',
        link,
        footer: 'The link is valid for 24 hours and can be used once. If you did not create a Bault account, ignore this message and nothing will happen.',
      });
    case 'password_reset':
      return actionEmail({
        heading: 'Reset your password',
        body: 'Somebody asked to reset the password on this Bault account. Follow the link below to choose a new one.',
        action: 'Choose a new password',
        link,
        footer: 'The link is valid for 1 hour and can be used once. If you did not ask for this, ignore this message — your current password stays in force.',
      });
    case 'notification_event':
      return actionEmail({
        heading: variables.heading ?? 'An update on your vault',
        body: variables.message ?? '',
        action: 'Open Bault',
        link,
        footer:
          variables.footer ??
          'You are receiving this because email is switched on for this kind of update. You can turn it off, per event or all at once, in Notifications → Preferences.',
      });
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
