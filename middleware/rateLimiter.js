// ─── Brute-force / rate-limit middleware ─────────────────────────────────────
//
// Tracks failed login and 2FA attempts per username (in memory).
// After MAX_ATTEMPTS failures the identifier is locked for LOCKOUT_MS.
// The lockout resets automatically once the window expires.
//
// Usage in route handlers:
//
//   const { checkRateLimit, recordFailedAttempt, clearAttempts } = require('../middleware/rateLimiter');
//
//   const limit = checkRateLimit(username);
//   if (!limit.allowed) return res.status(429).json({ error: limit.message });
//
//   // ... verify credentials ...
//   if (invalid) { recordFailedAttempt(username); return res.status(401)... }
//   clearAttempts(username);  // success — reset counter

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutes

// { [identifier]: { count: number, lockedUntil: number|null } }
const attempts = {};

/**
 * Check whether an identifier (username) is currently rate-limited.
 * Returns { allowed: true } or { allowed: false, message: string }.
 */
function checkRateLimit(identifier) {
  const record = attempts[identifier];
  if (!record) return { allowed: true };

  const now = Date.now();

  // Still locked
  if (record.lockedUntil && now < record.lockedUntil) {
    const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
    return {
      allowed: false,
      message: `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`
    };
  }

  // Lockout expired — clean up
  if (record.lockedUntil && now >= record.lockedUntil) {
    delete attempts[identifier];
  }

  return { allowed: true };
}

/**
 * Record a failed attempt for an identifier.
 * Locks the account if MAX_ATTEMPTS is reached.
 */
function recordFailedAttempt(identifier) {
  if (!attempts[identifier]) attempts[identifier] = { count: 0, lockedUntil: null };
  attempts[identifier].count++;
  if (attempts[identifier].count >= MAX_ATTEMPTS) {
    attempts[identifier].lockedUntil = Date.now() + LOCKOUT_MS;
    console.warn(`🔒 Account locked after ${MAX_ATTEMPTS} failed attempts: ${identifier}`);
  }
}

/**
 * Clear the attempt counter for an identifier (call on successful auth).
 */
function clearAttempts(identifier) {
  delete attempts[identifier];
}

/**
 * Returns remaining attempt count before lockout, or null if not tracked.
 * Useful for warning messages ("2 attempts remaining").
 */
function attemptsRemaining(identifier) {
  const record = attempts[identifier];
  if (!record || record.lockedUntil) return null;
  return Math.max(0, MAX_ATTEMPTS - record.count);
}

module.exports = { checkRateLimit, recordFailedAttempt, clearAttempts, attemptsRemaining, MAX_ATTEMPTS };
