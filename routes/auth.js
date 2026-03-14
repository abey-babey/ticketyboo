// ─── Auth routes  (/api/auth/*) ───────────────────────────────────────────────

const express                   = require('express');
const { store, safeUser }       = require('../lib/store');
const { generateToken }         = require('../lib/tokenUtils');
const { validatePasswordComplexity, isPasswordReused, isPasswordReusedAsync,
        hashPassword, verifyPassword, recordPasswordHistory } = require('../lib/passwordValidator');
const { sendEmail }             = require('../lib/emailService');
const { requireAuth }           = require('../middleware/requireAuth');
const { checkRateLimit, recordFailedAttempt, clearAttempts, attemptsRemaining, MAX_ATTEMPTS } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const {
    username, password, title, firstName, middleName, lastName, knownAs, gender,
    marketingPrefs, customerEmail, phone, addressLine1, addressLine2,
    postcode, city, county, country
  } = req.body;

  if (!username || !password || !firstName || !lastName || !customerEmail) {
    return res.status(400).json({ error: 'All required fields must be provided.' });
  }

  if (store.users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken.' });
  }

  const passwordError = validatePasswordComplexity(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const passwordHash = await hashPassword(password);

  const user = {
    id:            store.userIdCounter++,
    username,
    password:      passwordHash,
    passwordHistory: [],
    title:           title        || '',
    firstName,
    middleName:      middleName   || '',
    lastName,
    knownAs:         knownAs      || '',
    gender:          gender       || '',
    marketingPrefs: {
      email: !!(marketingPrefs && marketingPrefs.email),
      sms:   !!(marketingPrefs && marketingPrefs.sms),
      phone: !!(marketingPrefs && marketingPrefs.phone),
      post:  !!(marketingPrefs && marketingPrefs.post)
    },
    customerEmail,
    phone:           phone        || '',
    addressLine1:    addressLine1 || '',
    addressLine2:    addressLine2 || '',
    postcode:        postcode     || '',
    city:            city         || '',
    county:          county       || '',
    country:         country      || '',
    twoFactorEnabled: false,
    savedCards:       []
  };

  store.users.push(user);
  const token = generateToken();
  store.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });

  res.status(201).json({ success: true, token, user: safeUser(user) });
});

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  // Brute-force check
  const limit = checkRateLimit(username);
  if (!limit.allowed) return res.status(429).json({ error: limit.message });

  const userRecord = store.users.find(u => u.username === username);
  const passwordOk  = userRecord ? await verifyPassword(password, userRecord.password) : false;
  const user = passwordOk ? userRecord : null;
  if (!user) {
    recordFailedAttempt(username);
    const remaining = attemptsRemaining(username);
    const hint = remaining !== null && remaining > 0
      ? ` (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout)`
      : remaining === 0
        ? ' — account is now locked for 15 minutes'
        : '';
    return res.status(401).json({ error: `Invalid username or password${hint}.` });
  }

  // Credentials correct — clear lockout counter
  clearAttempts(username);

  // ── 2FA: generate OTP, send email, return challenge ──────────────────────
  if (user.twoFactorEnabled) {
    const otp         = String(Math.floor(100000 + Math.random() * 900000));
    const challengeId = generateToken();
    const expiresAt   = Date.now() + 10 * 60 * 1000;

    // One active challenge per user
    store.pendingTwoFa = store.pendingTwoFa.filter(c => c.userId !== user.id);
    store.pendingTwoFa.push({ challengeId, userId: user.id, otp, expiresAt, failCount: 0 });

    let previewUrl = null;
    try {
      previewUrl = await sendEmail({
        to:      user.customerEmail,
        subject: 'Ticketyboo — Your verification code',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#667eea">&#127915; Ticketyboo</h2>
            <p>Hi ${user.knownAs || user.firstName},</p>
            <p>Your sign-in verification code is:</p>
            <div style="font-size:2.5rem;font-weight:bold;letter-spacing:0.2em;text-align:center;
                        padding:1rem;background:#f0f4ff;border-radius:8px;margin:1.5rem 0">${otp}</div>
            <p>This code expires in <strong>10 minutes</strong>.</p>
            <p style="color:#888;font-size:0.85rem">If you did not attempt to sign in, you can ignore this email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0">
            <p style="color:#aaa;font-size:0.8rem">Ticketyboo &mdash; Test Automation Training App</p>
          </div>`
      });
    } catch (err) {
      console.error('Failed to send 2FA email:', err.message);
    }

    return res.json({ requiresTwoFa: true, challengeId, previewUrl });
  }

  const token = generateToken();
  store.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  res.json({ success: true, token, user: safeUser(user) });
});

// ─── POST /api/auth/verify-2fa ───────────────────────────────────────────────
router.post('/verify-2fa', (req, res) => {
  const { challengeId, otp } = req.body;

  if (!challengeId || !otp) {
    return res.status(400).json({ error: 'Challenge ID and verification code are required.' });
  }

  const challenge = store.pendingTwoFa.find(c => c.challengeId === challengeId);
  if (!challenge) {
    return res.status(400).json({ error: 'Invalid or expired challenge. Please sign in again.' });
  }

  // Brute-force protection on the 2FA endpoint (keyed by challengeId)
  const limit = checkRateLimit('2fa:' + challengeId);
  if (!limit.allowed) {
    store.pendingTwoFa = store.pendingTwoFa.filter(c => c.challengeId !== challengeId);
    return res.status(429).json({ error: limit.message });
  }

  if (Date.now() > challenge.expiresAt) {
    store.pendingTwoFa = store.pendingTwoFa.filter(c => c.challengeId !== challengeId);
    return res.status(400).json({ error: 'Verification code has expired. Please sign in again.' });
  }

  if (challenge.otp !== otp.trim()) {
    recordFailedAttempt('2fa:' + challengeId);
    const remaining = attemptsRemaining('2fa:' + challengeId);
    const hint      = remaining !== null && remaining > 0
      ? ` (${remaining} attempt${remaining === 1 ? '' : 's'} remaining)`
      : '';
    return res.status(400).json({ error: `Incorrect verification code${hint}. Please try again.` });
  }

  const user = store.users.find(u => u.id === challenge.userId);
  if (!user) return res.status(400).json({ error: 'User not found.' });

  clearAttempts('2fa:' + challengeId);
  store.pendingTwoFa = store.pendingTwoFa.filter(c => c.challengeId !== challengeId);

  const token = generateToken();
  store.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  res.json({ success: true, token, user: safeUser(user) });
});

// ─── POST /api/auth/reset-password/request ──────────────────────────────────
router.post('/reset-password/request', async (req, res) => {
  const { username, customerEmail } = req.body;
  if (!username || !customerEmail) {
    return res.status(400).json({ error: 'Username and email address are required.' });
  }

  const user = store.users.find(u => u.username === username && u.customerEmail === customerEmail);
  if (!user) {
    return res.status(404).json({ error: 'No account found with that username and email address.' });
  }

  // Invalidate any existing reset token for this user
  store.resetTokens = store.resetTokens.filter(t => t.userId !== user.id);

  const resetToken = Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt  = Date.now() + 15 * 60 * 1000;
  store.resetTokens.push({ token: resetToken, userId: user.id, expiresAt });

  let previewUrl = null;
  try {
    previewUrl = await sendEmail({
      to:      user.customerEmail,
      subject: 'Ticketyboo — Reset your password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#667eea">&#127915; Ticketyboo</h2>
          <p>Hi ${user.knownAs || user.firstName},</p>
          <p>We received a request to reset your password. Your reset code is:</p>
          <div style="font-size:2rem;font-weight:bold;letter-spacing:0.2em;text-align:center;
                      padding:1rem;background:#f0f4ff;border-radius:8px;margin:1.5rem 0">${resetToken}</div>
          <p>This code expires in <strong>15 minutes</strong>.</p>
          <p style="color:#888;font-size:0.85rem">If you did not request a password reset, you can ignore this email.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0">
          <p style="color:#aaa;font-size:0.8rem">Ticketyboo &mdash; Test Automation Training App</p>
        </div>`
    });
  } catch (err) {
    console.error('Failed to send reset email:', err.message);
  }

  res.json({ success: true, previewUrl });
});

// ─── POST /api/auth/reset-password/confirm ───────────────────────────────────
router.post('/reset-password/confirm', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  const entry = store.resetTokens.find(t => t.token === token.trim().toUpperCase());
  if (!entry) return res.status(400).json({ error: 'Invalid reset token.' });

  if (Date.now() > entry.expiresAt) {
    store.resetTokens = store.resetTokens.filter(t => t.token !== entry.token);
    return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
  }

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const user = store.users.find(u => u.id === entry.userId);
  if (!user) return res.status(400).json({ error: 'User not found.' });

  const reused = (await isPasswordReusedAsync(newPassword, user.passwordHistory)) ||
                 (await verifyPassword(newPassword, user.password));
  if (reused) {
    return res.status(400).json({ error: 'You have used this password recently. Please choose a new one.' });
  }

  recordPasswordHistory(user);
  user.password = await hashPassword(newPassword);
  store.resetTokens = store.resetTokens.filter(t => t.token !== entry.token);
  res.json({ success: true });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    store.sessions = store.sessions.filter(s => s.token !== token);
  }
  res.json({ success: true });
});

// ─── GET /api/auth/session ───────────────────────────────────────────────────
router.get('/session', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

module.exports = router;
