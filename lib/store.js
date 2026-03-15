// ─── Ephemeral in-memory store ────────────────────────────────────────────────
// Holds only short-lived data that does not need to survive a server restart.
// Persistent data (users, sessions, events, purchases, cards) lives in SQLite
// via lib/db.js.

const store = {
  // Short-lived OTP challenges (cleared on use or expiry)
  pendingTwoFa: [],

  // Short-lived password-reset tokens (cleared on use or expiry)
  resetTokens:  []
};

// safeUser() lives in lib/db.js — import it from there.

module.exports = { store };
