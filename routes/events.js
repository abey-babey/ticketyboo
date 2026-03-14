// ─── Event routes  (/api/events/*) ───────────────────────────────────────────

const express    = require('express');
const { store }  = require('../lib/store');

const router = express.Router();

// ─── GET /api/events ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { type } = req.query;
  const result = type ? store.events.filter(e => e.type === type) : store.events;
  res.json(result);
});

// ─── GET /api/events/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const event = store.events.find(e => e.id === parseInt(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json(event);
});

module.exports = router;
