// ─── Token utilities ──────────────────────────────────────────────────────────

/**
 * Generates a random, URL-safe token string.
 * Used for session tokens, 2FA challenge IDs, etc.
 */
function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

module.exports = { generateToken };
