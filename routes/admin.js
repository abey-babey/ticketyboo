// ─── Admin routes (/api/admin/*) ──────────────────────────────────────────────
// All routes require an authenticated admin user (requireAuth + requireRole).
// Destructive operations additionally require a specific permission.

'use strict';

const express  = require('express');
const { store }         = require('../lib/store');
const { generateToken } = require('../lib/tokenUtils');
const { sendEmail }     = require('../lib/emailService');
const db         = require('../lib/db');
const { requireAuth, requireRole, requirePermission } = require('../middleware/requireAuth');

const router = express.Router();

// ─── Baseline auth guard on every admin route ─────────────────────────────────
router.use(requireAuth, requireRole('admin'));

// ─── GET /api/admin/dashboard ─────────────────────────────────────────────────
router.get('/dashboard', requirePermission('admin:users:read'), (req, res) => {
  try {
    res.json(db.getDashboardStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/logs ──────────────────────────────────────────────────────
// Query params: level, category, from (YYYY-MM-DD), to, q, page, limit, csv
router.get('/logs', requirePermission('admin:logs:read'), (req, res) => {
  try {
    const { level, category, from, to, q, page = 1, limit = 50, csv } = req.query;
    const result = db.getLogs({ level, category, from, to, q, page, limit: Math.min(Number(limit), 500) });

    if (csv === '1' || csv === 'true') {
      // Audit-log the export
      db.writeLog('audit', 'admin', 'Log export via CSV', req.user.id, { filters: { level, category, from, to, q } });

      const header  = 'id,level,category,message,username,createdAt';
      const escape  = v => (v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"');
      const csvRows = result.rows.map(r =>
        [r.id, r.level, r.category, r.message, r.username || '', r.createdAt].map(escape).join(',')
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="app_log.csv"');
      return res.send([header, ...csvRows].join('\n'));
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/customers ─────────────────────────────────────────────────
// Query params: q, page, limit
router.get('/customers', requirePermission('admin:users:read'), (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    res.json(db.getCustomers({ q, page, limit: Math.min(Number(limit), 100) }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/customers/:id ─────────────────────────────────────────────
router.get('/customers/:id', requirePermission('admin:users:read'), (req, res) => {
  const detail = db.getCustomerDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Customer not found.' });
  res.json(db.safeUser(detail));
});

// ─── PUT /api/admin/customers/:id/suspend ─────────────────────────────────────
router.put('/customers/:id/suspend', requirePermission('admin:users:write'), (req, res) => {
  try {
    const id     = Number(req.params.id);
    const result = db.toggleSuspend(id);
    if (!result) return res.status(404).json({ error: 'Customer not found.' });

    const suspended = !!result.suspended;
    db.writeLog('audit', 'admin',
      `Admin ${req.user.username} ${suspended ? 'suspended' : 'unsuspended'} user id ${id}`,
      req.user.id, { targetUserId: id });

    res.json({ suspended });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/customers/:id/reset-password ─────────────────────────────
router.post('/customers/:id/reset-password', requirePermission('admin:users:write'), async (req, res) => {
  try {
    const id   = Number(req.params.id);
    const user = db.getUserById(id);
    if (!user || user.role !== 'user') return res.status(404).json({ error: 'Customer not found.' });

    // Invalidate any outstanding token for this user
    store.resetTokens = store.resetTokens.filter(t => t.userId !== user.id);

    const resetToken = generateToken().substring(0, 8).toUpperCase();
    const expiresAt  = Date.now() + 60 * 60 * 1000; // 1 hour
    store.resetTokens.push({ token: resetToken, userId: user.id, expiresAt });

    let previewUrl = null;
    try {
      previewUrl = await sendEmail({
        to:      user.customerEmail,
        subject: 'Your Ticketyboo password reset code',
        html: `<p>An administrator has requested a password reset for your account.</p>
               <div style="font-size:1.5rem;font-weight:bold;padding:1rem;background:#f0f4ff;border-radius:8px;margin:1.5rem 0;text-align:center">${resetToken}</div>
               <p>This code expires in 1 hour. If you did not expect this, please contact support.</p>`
      });
    } catch (emailErr) {
      console.error('Reset email failed:', emailErr.message);
    }

    db.writeLog('audit', 'admin',
      `Admin ${req.user.username} triggered password reset for user id ${id}`,
      req.user.id, { targetUserId: id });

    res.json({ ok: true, previewUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/admin/customers/:id ──────────────────────────────────────────
router.delete('/customers/:id', requirePermission('admin:users:delete'), (req, res) => {
  try {
    const id      = Number(req.params.id);
    const changes = db.deleteUser(id);
    if (!changes) return res.status(404).json({ error: 'Customer not found.' });

    db.writeLog('audit', 'admin',
      `Admin ${req.user.username} deleted user id ${id}`,
      req.user.id, { targetUserId: id });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/purchases ─────────────────────────────────────────────────
// Query params: from, to, eventId, userId, q, page, limit
router.get('/purchases', requirePermission('admin:purchases:read'), (req, res) => {
  try {
    const { from, to, eventId, userId, q, page = 1, limit = 20 } = req.query;
    res.json(db.getAdminPurchases({ from, to, eventId, userId, q, page, limit: Math.min(Number(limit), 100) }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/purchases/:id ─────────────────────────────────────────────
router.get('/purchases/:id', requirePermission('admin:purchases:read'), (req, res) => {
  const purchase = db.getPurchaseById(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });
  res.json(purchase);
});
// ─── GET /api/admin/support ─────────────────────────────────────────────────────────
router.get('/support', requirePermission('admin:support:write'), (req, res) => {
  try {
    const { status, priority, q, page = 1, limit = 20 } = req.query;
    res.json(db.getAdminSupportTickets({ status, priority, q, page, limit: Math.min(Number(limit), 100) }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/admin/support/:id ───────────────────────────────────────────────────────
router.put('/support/:id', requirePermission('admin:support:write'), (req, res) => {
  try {
    const id     = Number(req.params.id);
    const ticket = db.getSupportTicketDetail(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const { status, priority } = req.body;
    const updated = db.updateSupportTicket(id, { status, priority });

    db.writeLog('audit', 'support',
      `Admin ${req.user.username} updated ticket #${id}: status=${status || '-'} priority=${priority || '-'}`,
      req.user.id, { ticketId: id, status, priority });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/admin/support/:id/reply ──────────────────────────────────────────────
router.post('/support/:id/reply', requirePermission('admin:support:write'), async (req, res) => {
  try {
    const id     = Number(req.params.id);
    const ticket = db.getSupportTicketDetail(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Reply body is required.' });

    const msg = db.addSupportMessage(id, req.user.id, body.trim(), true);

    // Auto-move to in_progress if still open
    if (ticket.status === 'open') {
      db.updateSupportTicket(id, { status: 'in_progress' });
    }

    db.writeLog('audit', 'support',
      `Admin ${req.user.username} replied to ticket #${id}`,
      req.user.id, { ticketId: id });

    // Notify the customer by email
    const toEmail = ticket.userId ? ticket.userEmail : ticket.guestEmail;
    const toName  = ticket.userId ? (ticket.username || 'Customer') : ticket.guestName;
    let previewUrl = null;
    if (toEmail) {
      try {
        previewUrl = await sendEmail({
          to: toEmail,
          subject: `Re: ${ticket.subject} [Ref #${id}]`,
          html: `<p>Hi ${toName},</p>
                 <p>A member of our support team has replied to your request.</p>
                 <blockquote style="border-left:3px solid #6366f1;padding:0.5rem 1rem;margin:1rem 0">${body.trim().split('\n').join('<br>')}</blockquote>
                 <p>Log in to your account to view the full thread and reply.</p>`
        });
      } catch (emailErr) {
        console.error('Support reply email failed:', emailErr.message);
      }
    }

    res.status(201).json({ msg, previewUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
