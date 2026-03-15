// ─── Account routes  (/api/account/*) ────────────────────────────────────────

const express     = require('express');
const db          = require('../lib/db');
const { validatePasswordComplexity, isPasswordReusedAsync,
        hashPassword, verifyPassword } = require('../lib/passwordValidator');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ─── GET /api/account ────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  res.json({ user: db.safeUser(req.user) });
});

// ─── PUT /api/account ────────────────────────────────────────────────────────
router.put('/', requireAuth, (req, res) => {
  const user = req.user;
  const {
    username, title, firstName, middleName, lastName, knownAs, gender,
    customerEmail, phone, addressLine1, addressLine2, postcode, city, county, country,
    marketingPrefs, twoFactorEnabled
  } = req.body;

  if (!firstName || !lastName || !customerEmail) {
    return res.status(400).json({ error: 'First name, last name, and email are required.' });
  }

  if (username && username !== user.username) {
    const existing = db.getUserByUsername(username);
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ error: 'Username already taken.' });
    }
  }

  const updates = { firstName, lastName, customerEmail };
  if (username            !== undefined) updates.username          = username;
  if (title               !== undefined) updates.title             = title;
  if (middleName          !== undefined) updates.middleName        = middleName;
  if (knownAs             !== undefined) updates.knownAs           = knownAs;
  if (gender              !== undefined) updates.gender            = gender;
  if (phone               !== undefined) updates.phone             = phone;
  if (addressLine1        !== undefined) updates.addressLine1      = addressLine1;
  if (addressLine2        !== undefined) updates.addressLine2      = addressLine2;
  if (postcode            !== undefined) updates.postcode          = postcode;
  if (city                !== undefined) updates.city              = city;
  if (county              !== undefined) updates.county            = county;
  if (country             !== undefined) updates.country           = country;
  if (twoFactorEnabled    !== undefined) updates.twoFactorEnabled  = !!twoFactorEnabled;
  if (marketingPrefs) {
    updates.marketingPrefs = {
      email: !!marketingPrefs.email,
      sms:   !!marketingPrefs.sms,
      phone: !!marketingPrefs.phone,
      post:  !!marketingPrefs.post
    };
  }

  db.updateUser(user.id, updates);
  const updated = db.getUserById(user.id);
  res.json({ success: true, user: db.safeUser(updated) });
});

// ─── PUT /api/account/password ───────────────────────────────────────────────
router.put('/password', requireAuth, async (req, res) => {
  const user = req.user;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }

  if (!(await verifyPassword(currentPassword, user.password))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  if (await verifyPassword(newPassword, user.password)) {
    return res.status(400).json({ error: 'New password must be different from your current password.' });
  }

  const passwordHistory = db.getPasswordHistory(user.id);
  if (await isPasswordReusedAsync(newPassword, passwordHistory)) {
    return res.status(400).json({ error: 'You have used this password recently. Please choose a new one.' });
  }

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  db.addPasswordHistory(user.id, user.password);
  db.updateUser(user.id, { password: await hashPassword(newPassword) });
  res.json({ success: true });
});

// ─── GET /api/account/purchases ─────────────────────────────────────────────
router.get('/purchases', requireAuth, (req, res) => {
  const purchases = db.getPurchasesByUser(req.user.id);
  res.json({ purchases });
});

// ─── GET /api/account/cards ──────────────────────────────────────────────────
router.get('/cards', requireAuth, (req, res) => {
  const cards = db.getCardsByUser(req.user.id).map(c => ({
    id:             c.id,
    nickname:       c.nickname,
    cardholderName: c.cardholderName,
    cardLast4:      c.cardLast4,
    cardMasked:     c.cardMasked,
    cardExpiry:     c.cardExpiry,
    createdAt:      c.createdAt
  }));
  res.json({ cards });
});

// ─── POST /api/account/cards ─────────────────────────────────────────────────
router.post('/cards', requireAuth, (req, res) => {
  const user = req.user;
  const { nickname, cardNumber, cardExpiry, cardholderName } = req.body;

  if (!cardNumber || !cardExpiry || !cardholderName) {
    return res.status(400).json({ error: 'Card number, expiry date, and cardholder name are required.' });
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

  const card = db.createCard(user.id, {
    nickname:       nickname ? nickname.trim() : '',
    cardholderName: cardholderName.trim().toUpperCase(),
    cardLast4:      cardNumberClean.slice(-4),
    cardMasked:     '**** **** **** ' + cardNumberClean.slice(-4),
    cardExpiry
  });

  res.status(201).json({ success: true, card });
});

// ─── DELETE /api/account/cards/:cardId ───────────────────────────────────────
router.delete('/cards/:cardId', requireAuth, (req, res) => {
  const cardId = parseInt(req.params.cardId);
  const changes = db.deleteCard(cardId, req.user.id);
  if (changes === 0) return res.status(404).json({ error: 'Card not found.' });
  res.json({ success: true });
});

module.exports = router;

module.exports = router;