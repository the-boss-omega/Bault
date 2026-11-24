import { describe, it, expect } from 'vitest';
import {
  isPayPalApproveUrl,
  paypalReturnFromSearch,
  paypalReturnHash,
} from '../../apps/web/src/shared/paypalCheckout';

const ORIGIN = 'https://app.example.com';
const PAYMENT = '0f6b1c2e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

describe('where the cash-in screen will send a collector to pay', () => {
  it('goes to PayPal\'s own approval page, live or sandbox, over https', () => {
    expect(isPayPalApproveUrl('https://www.paypal.com/checkoutnow?token=ORDER-1', ORIGIN)).toBe(true);
    expect(isPayPalApproveUrl('https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1', ORIGIN)).toBe(true);
  });

  it('comes straight back to Bault itself when the sandbox provider stands in for PayPal', () => {
    expect(isPayPalApproveUrl(`${ORIGIN}/?paypal=approved&payment=${PAYMENT}&token=SBXO-1`, ORIGIN)).toBe(true);
  });

  it('goes nowhere else', () => {
    for (const href of [
      'http://www.paypal.com/checkoutnow?token=ORDER-1',
      'https://paypal.com.example.net/checkoutnow',
      'https://www.paypal.com.evil.example/checkoutnow',
      'https://evil.example/?next=https://www.paypal.com',
      'javascript:alert(1)',
      '//www.paypal.com/checkoutnow',
      'https://app.example.com.evil.example/',
      '',
    ]) {
      expect(isPayPalApproveUrl(href, ORIGIN), href).toBe(false);
    }
  });
});

describe('coming back from PayPal', () => {
  it('reads PayPal\'s return to Bault, with the token PayPal adds', () => {
    expect(paypalReturnFromSearch(`?paypal=approved&payment=${PAYMENT}&token=ORDER-1&PayerID=P1`)).toEqual({
      outcome: 'approved',
      paymentId: PAYMENT,
    });
    expect(paypalReturnFromSearch(`?paypal=cancelled&payment=${PAYMENT}&token=ORDER-1`)).toEqual({
      outcome: 'cancelled',
      paymentId: PAYMENT,
    });
  });

  it('ignores anything that is not a return from PayPal', () => {
    expect(paypalReturnFromSearch('')).toBeNull();
    expect(paypalReturnFromSearch('?paypal=approved')).toBeNull();
    expect(paypalReturnFromSearch('?paypal=whatever&payment=' + PAYMENT)).toBeNull();
    expect(paypalReturnFromSearch('?paypal=approved&payment=../../admin')).toBeNull();
  });

  it('opens the cash-in screen with the return in its address, so the screen finishes the payment', () => {
    expect(paypalReturnHash({ outcome: 'approved', paymentId: PAYMENT })).toBe(
      `#/wallet/cash-in?paypal=approved&payment=${PAYMENT}`,
    );
  });
});
