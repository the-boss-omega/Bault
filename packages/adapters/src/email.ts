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

/** Dev sink: logs the email (including the link) to the console instead of sending. */
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<{ providerRef: string }> {
    // eslint-disable-next-line no-console
    console.log(`[email] to=${message.to} template=${message.template}`, message.variables);
    return { providerRef: `console_${Date.now()}` };
  }
}
