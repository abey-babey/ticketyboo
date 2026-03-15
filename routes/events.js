// ─── Event routes  (/api/events/*) ───────────────────────────────────────────

const express = require('express');
const db      = require('../lib/db');

const router = express.Router();

// ─── GET /api/events/cities ──────────────────────────────────────────────────
// Must be defined before /:id to avoid 'cities' being treated as an id param.
router.get('/cities', (_req, res) => {
  res.json(db.getEventCities());
});

// ─── GET /api/events ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { type } = req.query;
  res.json(db.getEvents(type));
});

// ─── GET /api/events/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const event = db.getEventById(parseInt(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json(event);
});

module.exports = router;
