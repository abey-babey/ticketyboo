// ─── Customer support routes (/api/support/*) ─────────────────────────────────
// POST /api/support/tickets          — create a ticket (guest or authenticated)
// GET  /api/support/tickets          — list user's own tickets (auth required)
// GET  /api/support/tickets/:id      — get ticket + thread (auth, must own or admin)
// POST /api/support/tickets/:id/reply — customer reply (auth, must own)

'use strict';

const express  = require('express');
const db       = require('../lib/db');
const { sendEmail } = require('../lib/emailService');
const { requireAuth, optionalAuth } = require('../middleware/requireAuth');

const router = express.Router();

const VALID_SUBJECTS = [
  'Booking & Tickets',
  'Payment & Refunds',
  'Account & Login',
  'Event Information',
  'Technical Issue',
  'Accessibility Request',
  'Complaint',
  'Other'
];

// ─── POST /api/support/tickets ────────────────────────────────────────────────
// Open to guests and authenticated users.
router.post('/tickets', optionalAuth, async (req, res) => {
  try {
    const { subject, message, name, email, bookingRef } = req.body;

    // Validation
    if (!subject || !VALID_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'A valid subject is required.' });
    }
    if (!message || message.trim().length < 20) {
      return res.status(400).json({ error: 'Message must be at least 20 characters.' });
    }

    let userId    = null;
    let guestName = null;
    let guestEmail = null;

    if (req.user) {
      // Authenticated — use account details
      userId = req.user.id;
    } else {
      // Guest — name and email are required
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required for guest submissions.' });
      if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required for guest submissions.' });
      guestName  = name.trim();
      guestEmail = email.trim().toLowerCase();
    }

    const body = bookingRef
      ? `${message.trim()}\n\n[Booking ref: ${bookingRef}]`
      : message.trim();

    const ticket = db.createSupportTicket({ userId, guestName, guestEmail, subject, initialMessage: body });

    db.writeLog('info', 'support',
      `Support ticket #${ticket.id} created — "${subject}"`,
      userId, { guestEmail, ticketId: ticket.id });

    // Send confirmation email to guest
    if (!req.user && guestEmail) {
      let previewUrl = null;
      try {
        previewUrl = await sendEmail({
          to: guestEmail,
          subject: `Support request received — Ref #${ticket.id}`,
          html: `<p>Hi ${guestName},</p>
                 <p>We've received your support request and will be in touch shortly.</p>
                 <p><strong>Reference:</strong> #${ticket.id}<br>
                    <strong>Subject:</strong> ${subject}</p>
                 <p>Please keep this email for your records.</p>`
        });
      } catch (emailErr) {
        console.error('Support confirmation email failed:', emailErr.message);
      }
      return res.status(201).json({ ok: true, ticketId: ticket.id, previewUrl });
    }

    res.status(201).json({ ok: true, ticketId: ticket.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/support/tickets ─────────────────────────────────────────────────
// Returns all tickets belonging to the authenticated user.
router.get('/tickets', requireAuth, (req, res) => {
  try {
    const tickets = db.getSupportTicketsByUser(req.user.id);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/support/tickets/:id ─────────────────────────────────────────────
// Customer can only view their own tickets. Admin can view any.
router.get('/tickets/:id', requireAuth, (req, res) => {
  try {
    const id     = Number(req.params.id);
    const ticket = db.getSupportTicketDetail(id);

    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const isOwner = ticket.userId === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied.' });

    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/support/tickets/:id/reply ──────────────────────────────────────
// Customer reply on their own ticket (only on open or in_progress tickets).
router.post('/tickets/:id/reply', requireAuth, (req, res) => {
  try {
    const id     = Number(req.params.id);
    const ticket = db.getSupportTicketDetail(id);

    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    if (ticket.userId !== req.user.id) return res.status(403).json({ error: 'Access denied.' });
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      return res.status(400).json({ error: 'Cannot reply to a resolved or closed ticket.' });
    }

    const { body } = req.body;
    if (!body || body.trim().length < 1) return res.status(400).json({ error: 'Reply body is required.' });

    const msg = db.addSupportMessage(id, req.user.id, body.trim(), false);

    db.writeLog('info', 'support', `Customer reply on ticket #${id}`, req.user.id, { ticketId: id });

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
