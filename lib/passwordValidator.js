// ─── Password / Passphrase Validator ─────────────────────────────────────────

const bcrypt = require('bcryptjs');
const SALT_ROUNDS = 10;
//
// Supports two valid credential styles, reflecting current NCSC / NIST SP 800-63B guidance:
//
//   TRADITIONAL PASSWORD  — 8+ chars with uppercase, lowercase, digit, and special character
//   PASSPHRASE            — 20+ chars (e.g. "BadgerLemonSculpture892") with at least 2 uppercase
//                           letters (to indicate distinct capitalised words) and at least 1 digit.
//                           No special character required.
//
// Callers receive null on success or a descriptive error string on failure.
// The exported `getPasswordMode()` function tells client-side code which mode
// the current value is heading towards, to drive the dual-mode checklist UI.

const PASSWORD_MIN_LENGTH    = 8;
const PASSPHRASE_MIN_LENGTH  = 20;
const PASSPHRASE_MIN_UPPERS  = 2;   // roughly one per 'word'
const PASSWORD_HISTORY_LIMIT = 5;   // remember last N passwords for reuse prevention

/**
 * Returns 'passphrase' when the input is long enough to be evaluated as a
 * passphrase, 'password' otherwise.  Used by the client-side UI.
 */
function getPasswordMode(value) {
  return value && value.length >= PASSPHRASE_MIN_LENGTH ? 'passphrase' : 'password';
}

/**
 * Validates a password/passphrase.
 * Returns null if valid, or a human-readable error string if not.
 */
function validatePasswordComplexity(password) {
  if (!password) return 'Password is required.';

  // ── Passphrase path (20+ chars) ──────────────────────────────────────────
  if (password.length >= PASSPHRASE_MIN_LENGTH) {
    const upperCount = (password.match(/[A-Z]/g) || []).length;
    if (upperCount < PASSPHRASE_MIN_UPPERS) {
      return `Passphrase must contain at least ${PASSPHRASE_MIN_UPPERS} uppercase letters (one per word, e.g. BadgerLemonSculpture892).`;
    }
    if (!/[0-9]/.test(password)) {
      return 'Passphrase must contain at least one number (e.g. BadgerLemonSculpture892).';
    }
    return null; // ✓ valid passphrase
  }

  // ── Traditional password path (8–19 chars) ───────────────────────────────
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters, or use a passphrase of ${PASSPHRASE_MIN_LENGTH}+ characters.`;
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter (A–Z).';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter (a–z).';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number (0–9).';
  if (!/[!@#$%^&*]/.test(password)) {
    return 'Password must contain at least one special character (! @ # $ % ^ & *).';
  }
  return null; // ✓ valid password
}

/**
 * Hashes a plain-text password.  Returns a bcrypt hash string.
 */
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verifies a plain-text password against a stored bcrypt hash.
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Async version of isPasswordReused — compares against bcrypt-hashed history.
 */
async function isPasswordReusedAsync(newPassword, passwordHistory) {
  if (!Array.isArray(passwordHistory) || passwordHistory.length === 0) return false;
  for (const hash of passwordHistory) {
    if (await bcrypt.compare(newPassword, hash)) return true;
  }
  return false;
}

/**
 * Checks whether a proposed new password was recently used.
 * Legacy sync version kept for reference — use isPasswordReusedAsync with hashes.
 */
function isPasswordReused(newPassword, passwordHistory) {
  if (!Array.isArray(passwordHistory)) return false;
  return passwordHistory.includes(newPassword);
}

/**
 * Pushes the current password into the history array before it is replaced,
 * trimming to PASSWORD_HISTORY_LIMIT most-recent entries.
 */
function recordPasswordHistory(user) {
  if (!user.passwordHistory) user.passwordHistory = [];
  user.passwordHistory.push(user.password);
  if (user.passwordHistory.length > PASSWORD_HISTORY_LIMIT) {
    user.passwordHistory = user.passwordHistory.slice(-PASSWORD_HISTORY_LIMIT);
  }
}

module.exports = {
  validatePasswordComplexity,
  isPasswordReused,
  isPasswordReusedAsync,
  hashPassword,
  verifyPassword,
  recordPasswordHistory,
  getPasswordMode,
  PASSWORD_MIN_LENGTH,
  PASSPHRASE_MIN_LENGTH
};
