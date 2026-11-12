import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../utils/http.js';

const BASE = 'https://api.paystack.co';

/** Payments are "live" (real Paystack, test or live keys) when a secret key is set, otherwise simulated. */
export const paystackEnabled = () => Boolean(config.paystackSecret);

async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      ...options,
      headers: { Authorization: `Bearer ${config.paystackSecret}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(502, 'We could not reach Paystack. Try again in a moment.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) throw new HttpError(502, data.message || 'Paystack did not accept the request.');
  return data.data;
}

/** Starts a payment and returns the Paystack checkout page URL. Amounts go to Paystack in kobo. */
export function initializePayment({ email, amountNaira, reference, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, amount: amountNaira * 100, reference, callback_url: callbackUrl, currency: 'NGN', metadata }),
  });
}

export const verifyPayment = (reference) => call(`/transaction/verify/${encodeURIComponent(reference)}`);

/** Checks that a webhook really came from Paystack (HMAC SHA-512 of the raw body with our secret key). */
export function isValidWebhook(rawBody, signature) {
  if (!config.paystackSecret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha512', config.paystackSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
