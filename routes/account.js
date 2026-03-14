// ─── Account routes  (/api/account/*) ────────────────────────────────────────

const express     = require('express');
const { store, safeUser } = require('../lib/store');
const { validatePasswordComplexity, isPasswordReusedAsync,
        hashPassword, verifyPassword, recordPasswordHistory } = require('../lib/passwordValidator');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

// ─── GET /api/account ────────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
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
    if (store.users.find(u => u.username === username && u.id !== user.id)) {
      return res.status(409).json({ error: 'Username already taken.' });
    }
    user.username = username;
  }

  if (title            !== undefined) user.title            = title;
  user.firstName        = firstName;
  if (middleName       !== undefined) user.middleName       = middleName;
  user.lastName         = lastName;
  if (knownAs          !== undefined) user.knownAs          = knownAs;
  if (gender           !== undefined) user.gender           = gender;
  user.customerEmail    = customerEmail;
  if (phone            !== undefined) user.phone            = phone;
  if (addressLine1     !== undefined) user.addressLine1     = addressLine1;
  if (addressLine2     !== undefined) user.addressLine2     = addressLine2;
  if (postcode         !== undefined) user.postcode         = postcode;
  if (city             !== undefined) user.city             = city;
  if (county           !== undefined) user.county           = county;
  if (country          !== undefined) user.country          = country;
  if (twoFactorEnabled !== undefined) user.twoFactorEnabled = !!twoFactorEnabled;
  if (marketingPrefs) {
    user.marketingPrefs = {
      email: !!marketingPrefs.email,
      sms:   !!marketingPrefs.sms,
      phone: !!marketingPrefs.phone,
      post:  !!marketingPrefs.post
    };
  }

  res.json({ success: true, user: safeUser(user) });
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

  if (await isPasswordReusedAsync(newPassword, user.passwordHistory)) {
    return res.status(400).json({ error: 'You have used this password recently. Please choose a new one.' });
  }

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  recordPasswordHistory(user);
  user.password = await hashPassword(newPassword);
  res.json({ success: true });
});

// ─── GET /api/account/purchases ─────────────────────────────────────────────
router.get('/purchases', requireAuth, (req, res) => {
  const purchases = store.purchases
    .filter(p => p.userId === req.user.id)
    .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
  res.json({ purchases });
});

// ─── GET /api/account/cards ──────────────────────────────────────────────────
router.get('/cards', requireAuth, (req, res) => {
  const cards = (req.user.savedCards || []).map(c => ({
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

  if (!user.savedCards) user.savedCards = [];

  const card = {
    id:             store.cardIdCounter++,
    nickname:       nickname ? nickname.trim() : '',
    cardholderName: cardholderName.trim().toUpperCase(),
    cardLast4:      cardNumberClean.slice(-4),
    cardMasked:     '**** **** **** ' + cardNumberClean.slice(-4),
    cardExpiry,
    createdAt:      new Date().toISOString()
  };

  user.savedCards.push(card);
  res.status(201).json({ success: true, card });
});

// ─── DELETE /api/account/cards/:cardId ───────────────────────────────────────
router.delete('/cards/:cardId', requireAuth, (req, res) => {
  const user   = req.user;
  const cardId = parseInt(req.params.cardId);

  if (!user.savedCards) return res.status(404).json({ error: 'Card not found.' });

  const idx = user.savedCards.findIndex(c => c.id === cardId);
  if (idx === -1) return res.status(404).json({ error: 'Card not found.' });

  user.savedCards.splice(idx, 1);
  res.json({ success: true });
});

module.exports = router;
