import express, { Router } from 'express';
import { query } from '../db.js';
import { asyncRoute } from '../utils/http.js';
import { isValidWebhook } from '../services/paystack.js';
import { confirmOrder } from '../services/orders.js';

const router = Router();

// POST /api/payments/webhook -> Paystack tells us a payment succeeded.
// Uses the raw body because the signature is calculated over the exact bytes Paystack sent.
router.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '200kb' }),
  asyncRoute(async (req, res) => {
    if (!isValidWebhook(req.body, req.headers['x-paystack-signature'])) return res.sendStatus(401);
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.currency === 'NGN') {
      const [order] = await query('SELECT id FROM orders WHERE payment_ref = ?', [event.data.reference]);
      if (order) await confirmOrder(order.id, Math.round(event.data.amount / 100));
    }
    res.sendStatus(200); // always acknowledge so Paystack stops retrying
  })
);

export default router;
