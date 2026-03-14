// ─── Entry point ─────────────────────────────────────────────────────────────
// server.js is intentionally thin — all logic lives in routes/ and lib/.
//
// Structure:
//   lib/store.js             — shared in-memory data store + safeUser()
//   lib/tokenUtils.js        — generateToken()
//   lib/passwordValidator.js — dual-mode password/passphrase validation + reuse check
//   lib/emailService.js      — Ethereal fake-SMTP transport
//   middleware/requireAuth.js — Bearer token auth middleware
//   middleware/rateLimiter.js — brute-force lockout (login + 2FA)
//   routes/auth.js           — /api/auth/*
//   routes/account.js        — /api/account/*
//   routes/events.js         — /api/events/*
//   routes/tickets.js        — /api/tickets/*

const express    = require('express');
const path       = require('path');
const { initEmailTransport } = require('./lib/emailService');

const app  = require('./app');
const PORT = process.env.PORT || 3000;

initEmailTransport().then(() => {
  app.listen(PORT, () => {
    console.log(`Ticketyboo server running on http://localhost:${PORT}`);
    console.log('Password storage: bcryptjs (cost factor 10) — plain-text passwords are never stored.');
  });
});
