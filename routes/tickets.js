// ─── Ticket routes  (/api/tickets/*) ─────────────────────────────────────────

const express    = require('express');
const { store }  = require('../lib/store');

const router = express.Router();

// ─── POST /api/tickets/purchase ──────────────────────────────────────────────
router.post('/purchase', (req, res) => {
  const { eventId, quantity, customerName, customerEmail, cardNumber, cardExpiry, cardCvv, cardholderName } = req.body;

  if (!eventId || !quantity || !customerName || !customerEmail) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!cardNumber || !cardExpiry || !cardCvv || !cardholderName) {
    return res.status(400).json({ error: 'Missing payment card information.' });
  }

  const cardNumberClean = cardNumber.replace(/\s/g, '');
  if (cardNumberClean.length < 13 || cardNumberClean.length > 19) {
    return res.status(400).json({ error: 'Invalid card number.' });
  }

  if (!/^\d{2}\/\d{2}$/.test(cardExpiry)) {
    return res.status(400).json({ error: 'Invalid expiry date format (MM/YY).' });
  }

  const [expMonth, expYear] = cardExpiry.split('/').map(n => parseInt(n, 10));
  const now          = new Date();
  const currentYear  = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    return res.status(400).json({ error: 'Card has expired.' });
  }

  if (!/^\d{3,4}$/.test(cardCvv)) {
    return res.status(400).json({ error: 'Invalid CVV.' });
  }

  const event = store.events.find(e => e.id === parseInt(eventId));
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1.' });
  if (quantity > event.availableTickets) {
    return res.status(400).json({ error: 'Not enough tickets available.' });
  }

  event.availableTickets -= quantity;

  const purchase = {
    id:           store.purchaseIdCounter++,
    eventId:      event.id,
    eventName:    event.name,
    quantity,
    customerName,
    customerEmail,
    totalPrice:   event.price * quantity,
    cardholderName,
    cardLast4:    cardNumberClean.slice(-4),
    cardMasked:   '**** **** **** ' + cardNumberClean.slice(-4),
    purchaseDate: new Date().toISOString()
  };

  store.purchases.push(purchase);
  res.status(201).json({ success: true, purchase });
});

// ─── GET /api/tickets ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(store.purchases);
});

// ─── GET /api/tickets/:id ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const purchase = store.purchases.find(p => p.id === parseInt(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
  res.json(purchase);
});

module.exports = router;
