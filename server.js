// server.js — Angeli's Catering Payment Backend (Stripe)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3001;

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: "Angeli's Payment API", version: '2026-04-03-stripe' });
});

// ─── Create Payment Intent (card + Apple Pay) ──────────────────────────────────
app.post('/create-payment-intent', async (req, res) => {
  const { amount, email, name, orderDescription } = req.body;

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid amount' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(parseFloat(amount) * 100), // cents
      currency: 'usd',
      receipt_email: email || undefined,
      description: orderDescription || "Angeli's Catering Order",
      metadata: { name: name || '' },
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Angeli's payment server running on port ${PORT}`);
});
