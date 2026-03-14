// ─── Ticket routes  (/api/tickets/*) ─────────────────────────────────────────

const express      = require('express');
const PDFDocument  = require('pdfkit');
const QRCode       = require('qrcode');
const { store }    = require('../lib/store');
const { optionalAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ─── POST /api/tickets/purchase ──────────────────────────────────────────────
router.post('/purchase', optionalAuth, (req, res) => {
  const {
    eventId, quantity, customerName, customerEmail,
    cardNumber, cardExpiry, cardCvv, cardholderName,
    savedCardId
  } = req.body;

  if (!eventId || !quantity || !customerName || !customerEmail) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // ── Payment resolution ──────────────────────────────────────────────────────
  let resolvedCardholderName, resolvedCardLast4, resolvedCardMasked;

  if (savedCardId) {
    // Using a saved card — requires authentication
    if (!req.user) {
      return res.status(401).json({ error: 'You must be signed in to use a saved card.' });
    }
    const card = (req.user.savedCards || []).find(c => c.id === parseInt(savedCardId));
    if (!card) {
      return res.status(404).json({ error: 'Saved card not found.' });
    }
    resolvedCardholderName = card.cardholderName;
    resolvedCardLast4      = card.cardLast4;
    resolvedCardMasked     = card.cardMasked;
  } else {
    // Raw card entry — validate all card fields
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

    resolvedCardholderName = cardholderName;
    resolvedCardLast4      = cardNumberClean.slice(-4);
    resolvedCardMasked     = '**** **** **** ' + cardNumberClean.slice(-4);
  }

  const event = store.events.find(e => e.id === parseInt(eventId));
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  if (quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1.' });
  if (quantity > event.availableTickets) {
    return res.status(400).json({ error: 'Not enough tickets available.' });
  }

  event.availableTickets -= quantity;

  const purchase = {
    id:             store.purchaseIdCounter++,
    eventId:        event.id,
    eventName:      event.name,
    quantity,
    customerName,
    customerEmail,
    totalPrice:     event.price * quantity,
    cardholderName: resolvedCardholderName,
    cardLast4:      resolvedCardLast4,
    cardMasked:     resolvedCardMasked,
    purchaseDate:   new Date().toISOString()
  };

  // Link to user account if authenticated
  if (req.user) purchase.userId = req.user.id;

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

// ─── GET /api/tickets/:id/pdf ─────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  const purchase = store.purchases.find(p => p.id === parseInt(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

  try {
    const qrPayload = JSON.stringify({
      app:        'ticketyboo',
      purchaseId: purchase.id,
      eventId:    purchase.eventId,
      eventName:  purchase.eventName,
      qty:        purchase.quantity,
      email:      purchase.customerEmail,
      date:       purchase.purchaseDate
    });
    const qrBuffer = await QRCode.toBuffer(qrPayload, { width: 180, margin: 2 });

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ticket-${purchase.id}.pdf"`);
    doc.pipe(res);

    // ── Header ────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#667eea')
       .text('Ticketyboo', { align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(13).fillColor('#555')
       .text('Ticket Confirmation', { align: 'center' });
    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#667eea').lineWidth(1.5).stroke();
    doc.moveDown(0.8);

    // ── Event details ─────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#667eea').text('Event Details');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(11).fillColor('#333');
    doc.text(`Event:          ${purchase.eventName}`);
    doc.text(`Tickets:        ${purchase.quantity}`);
    doc.text(`Total Paid:     \u00A3${purchase.totalPrice.toFixed(2)}`);
    doc.text(`Purchase Date:  ${new Date(purchase.purchaseDate).toLocaleString('en-GB')}`);
    doc.moveDown(0.8);

    // ── Customer details ──────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#667eea').text('Customer Details');
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(11).fillColor('#333');
    doc.text(`Name:           ${purchase.customerName}`);
    doc.text(`Email:          ${purchase.customerEmail}`);
    doc.text(`Payment:        ${purchase.cardMasked}  (${purchase.cardholderName})`);
    doc.moveDown(0.8);

    // ── Booking reference ─────────────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#eee').lineWidth(0.5).stroke();
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#667eea')
       .text('Booking Reference', { align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(28).fillColor('#333')
       .text(`#${purchase.id}`, { align: 'center' });
    doc.moveDown(0.8);

    // ── QR code ───────────────────────────────────────────────────────────────
    const qrX = (doc.page.width - 180) / 2;
    doc.image(qrBuffer, qrX, doc.y, { width: 180 });
    doc.moveDown(7);
    doc.font('Helvetica').fontSize(9).fillColor('#888')
       .text('Scan QR code at the venue entrance', { align: 'center' });

    // ── Footer ────────────────────────────────────────────────────────────────
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#eee').lineWidth(0.5).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#aaa')
       .text('Ticketyboo \u2014 Test Automation Training Application', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate ticket PDF.' });
  }
});

module.exports = router;
