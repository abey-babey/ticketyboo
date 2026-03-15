// ─── Express application ──────────────────────────────────────────────────────
// Configures middleware and mounts all route modules.
// Kept separate from server.js so the app can be imported by tests
// without immediately starting a listener.

const express = require('express');
const path    = require('path');

const authRoutes    = require('./routes/auth');
const accountRoutes = require('./routes/account');
const eventRoutes   = require('./routes/events');
const ticketRoutes  = require('./routes/tickets');
const adminRoutes   = require('./routes/admin');
const supportRoutes = require('./routes/support');

const app = express();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/events',  eventRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/support', supportRoutes);

// ─── Admin panel ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.redirect('/admin');
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
