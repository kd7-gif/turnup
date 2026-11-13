import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError, asyncRoute, cleanString } from '../utils/http.js';
import { priceOrder } from '../services/pricing.js';
import { cancelOrder, confirmOrder, createOrderWithHold, loadOrder, newOrderNumber, releaseExpiredHolds } from '../services/orders.js';
import { initializePayment, paystackEnabled, verifyPayment } from '../services/paystack.js';

const router = Router();
// 30 checkouts a minute per account (not per network, so a whole office or campus Wi-Fi can still buy)
const checkoutLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}` });

const publicQuote = ({ event, ...q }) => ({ ...q, promo: q.promo && { code: q.promo.code, label: q.promo.label } });

// POST /api/orders/quote -> prices for the chosen tickets (anyone can ask, nothing is saved)
router.post(
  '/quote',
  asyncRoute(async (req, res) => {
    await releaseExpiredHolds();
    res.json(publicQuote(await priceOrder({ eventSlug: req.body.event_slug, items: req.body.items, promoCode: req.body.promo_code })));
  })
);

// POST /api/orders -> creates the order. Free orders are confirmed straight away; paid ones start a payment.
router.post(
  '/',
  requireAuth(),
  checkoutLimiter,
  asyncRoute(async (req, res) => {
    await releaseExpiredHolds();
    const q = await priceOrder({ eventSlug: req.body.event_slug, items: req.body.items, promoCode: req.body.promo_code });
    const order_number = newOrderNumber();
    // Holds the tickets for 10 minutes, or fails with "only N left" if someone got there first
    const orderId = await createOrderWithHold({ orderNumber: order_number, userId: req.user.id, quote: q });

    if (q.total === 0) {
      const status = await confirmOrder(orderId, 0);
      if (status === 'failed') throw new HttpError(409, 'Those tickets just ran out. Try another ticket type.');
      return res.status(201).json({ order_number, payment: { mode: 'free' } });
    }

    if (!paystackEnabled()) return res.status(201).json({ order_number, payment: { mode: 'simulated' } });

    const reference = `${order_number}-${Date.now()}`;
    await query('UPDATE orders SET payment_ref = ? WHERE id = ?', [reference, orderId]);
    const [user] = await query('SELECT email FROM users WHERE id = ?', [req.user.id]);
    const init = await initializePayment({
      email: user.email, amountNaira: q.total, reference,
      callbackUrl: `${config.publicUrl}/orders/${order_number}?ref=${encodeURIComponent(reference)}`,
      metadata: { order_number, event: q.event.title },
    });
    res.status(201).json({ order_number, payment: { mode: 'paystack', authorization_url: init.authorization_url } });
  })
);

async function ownOrderId(number, userId) {
  const [o] = await query('SELECT id, status, total, payment_ref FROM orders WHERE order_number = ? AND user_id = ?',
    [cleanString(number, 20), userId]);
  if (!o) throw new HttpError(404, 'We could not find that order.');
  return o;
}

// GET /api/orders/:number -> one of the signed-in user's orders, with tickets once paid
router.get(
  '/:number',
  requireAuth(),
  asyncRoute(async (req, res) => {
    await releaseExpiredHolds(); // so an order whose hold just ran out shows as expired straight away
    const order = await loadOrder(cleanString(req.params.number, 20), req.user.id);
    if (!order) throw new HttpError(404, 'We could not find that order.');
    res.json({ order, payment_mode: paystackEnabled() ? 'paystack' : 'simulated' });
  })
);

// POST /api/orders/:number/verify-payment -> after Paystack sends the buyer back, ask Paystack if it really went through
router.post(
  '/:number/verify-payment',
  requireAuth(),
  asyncRoute(async (req, res) => {
    const o = await ownOrderId(req.params.number, req.user.id);
    if (o.status === 'pending' && o.payment_ref && paystackEnabled()) {
      const tx = await verifyPayment(o.payment_ref);
      if (tx.status === 'success' && tx.currency === 'NGN') await confirmOrder(o.id, Math.round(tx.amount / 100));
    }
    res.json({ order: await loadOrder(cleanString(req.params.number, 20), req.user.id) });
  })
);

// POST /api/orders/:number/cancel -> give the held tickets back straight away
router.post(
  '/:number/cancel',
  requireAuth(),
  asyncRoute(async (req, res) => {
    const o = await ownOrderId(req.params.number, req.user.id);
    await cancelOrder(o.id);
    res.json({ order: await loadOrder(cleanString(req.params.number, 20), req.user.id) });
  })
);

// POST /api/orders/:number/simulate-payment -> test payments when Paystack is not set up (never in production with a key)
router.post(
  '/:number/simulate-payment',
  requireAuth(),
  asyncRoute(async (req, res) => {
    if (paystackEnabled()) throw new HttpError(400, 'Test payments are off because real payments are set up.');
    await releaseExpiredHolds(); // a test payment after the hold ended behaves like a late real payment
    const o = await ownOrderId(req.params.number, req.user.id);
    await confirmOrder(o.id, o.total);
    res.json({ order: await loadOrder(cleanString(req.params.number, 20), req.user.id) });
  })
);

export default router;
