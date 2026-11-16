/**
 * Cash-in by PayPal checkout leaves the app for PayPal's own page and comes back to it. PayPal's
 * JavaScript is never loaded here, so the Content Security Policy stays as strict as it is: the
 * collector approves on paypal.com, and the server captures when they return.
 */

export type PayPalReturnOutcome = 'approved' | 'cancelled';

export interface PayPalReturn {
  outcome: PayPalReturnOutcome;
  paymentId: string;
}

const PAYPAL_HOSTS = new Set(['www.paypal.com', 'www.sandbox.paypal.com']);
const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only places the cash-in screen sends a collector: PayPal's approval page over https, or back to
 * this app itself, which is where the sandbox provider "approves" an order at once.
 */
export function isPayPalApproveUrl(href: string, appOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === 'https:' && PAYPAL_HOSTS.has(url.hostname) && url.port === '') return true;
  return url.origin === appOrigin;
}

export function leaveForPayPal(href: string): void {
  window.location.assign(href);
}

/** PayPal sends the collector back to `/?paypal=<outcome>&payment=<id>`, and adds its own token. */
export function paypalReturnFromSearch(search: string): PayPalReturn | null {
  const params = new URLSearchParams(search);
  const outcome = params.get('paypal');
  const paymentId = params.get('payment') ?? '';
  if ((outcome !== 'approved' && outcome !== 'cancelled') || !PAYMENT_ID.test(paymentId)) return null;
  return { outcome, paymentId };
}

/** The app is a hash router: the return becomes the cash-in screen, carrying what to finish. */
export function paypalReturnHash(back: PayPalReturn): string {
  return `#/wallet/cash-in?${new URLSearchParams({ paypal: back.outcome, payment: back.paymentId }).toString()}`;
}

/** Called once, before the app renders: turn PayPal's return into the cash-in screen's address. */
export function adoptPayPalReturn(): void {
  try {
    const back = paypalReturnFromSearch(window.location.search);
    if (back) window.history.replaceState(null, '', `${window.location.pathname}${paypalReturnHash(back)}`);
  } catch {
    // An address the browser will not let us rewrite is left as it is; the server captures on PayPal's webhook.
  }
}
