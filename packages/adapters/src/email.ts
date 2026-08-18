import { createTransport, type Transporter } from 'nodemailer';

/**
 * Transactional email adapter (T020). Verification links + event notifications.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, string>;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<{ providerRef: string }>;
}

/* ============================================================
   Templates
   ============================================================ */

/**
 * The rendered body of one message, in both parts a mail client may read.
 *
 * Both are always produced. A text-only client — and every spam filter — reads
 * `text`, and a link that exists only inside an anchor tag is invisible to
 * both, so the URL is written out in full in the plain part too.
 */
export interface RenderedEmail {
  text: string;
  html: string;
}

/** Escape the four characters that would otherwise break out of HTML text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A message body built around a single call to action.
 *
 * Every transactional mail Bault sends has exactly this shape: a sentence of
 * context, one link, and a line saying what happens if it is ignored. Keeping
 * it as one function means a new template cannot accidentally arrive without a
 * plain-text part or with an unescaped URL.
 */
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

/**
 * Render a message body from its template name and variables.
 *
 * An unknown template does NOT throw: a mail that fails to render would abort
 * the registration or reset that triggered it, which is a far worse outcome
 * than a plainly-formatted message. It degrades to the variables it was given.
 */
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
      /**
       * One domain event, as a mail.
       *
       * The body is the SAME sentence the in-app feed shows — composed once by
       * the worker and passed through here. Two channels telling somebody two
       * differently-worded versions of one event is how a support conversation
       * starts with "which one is right?".
       */
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

/* ============================================================
   Adapters
   ============================================================ */

/** Dev sink: logs the email (including the link) to the console instead of sending. */
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
  /** true = implicit TLS (465); false = STARTTLS upgrade (587). */
  secure: boolean;
  user: string;
  password: string;
  /** Envelope sender, e.g. `Bault <noreply@example.com>`. */
  from: string;
}

/**
 * Real SMTP delivery.
 *
 * Works with any SMTP server; the configuration documented in `.env.example` is
 * Gmail with an app password, which is the cheapest way to get genuine delivery
 * in development without standing up a provider account.
 *
 * The credentials arrive through the constructor rather than being read from
 * `process.env` here, so this package stays free of the config schema and the
 * adapter is directly testable with a fake transport.
 *
 * `verify()` is deliberately NOT called at construction: the API must boot
 * whether or not the mail server is reachable, and a failure surfaces on the
 * first send with the provider's own error rather than as a dead process.
 */
export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
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
    // The provider's own message id, so a delivery can be traced back from the
    // mail server's logs. Falls back to a local stamp if the server omits it.
    return { providerRef: info.messageId ?? `smtp_${Date.now()}` };
  }
}
