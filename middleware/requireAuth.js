// ─── Auth middleware ──────────────────────────────────────────────────────────
// Validates the Bearer token on protected routes and attaches req.user.

const { store } = require('../lib/store');

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.substring(7);
  const session = store.sessions.find(s => s.token === token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const user = store.users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = user;
  next();
}

/**
 * Sets req.user if a valid Bearer token is present, but never blocks the request.
 * Use this on routes that serve both guests and authenticated users.
 */
function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    const session = store.sessions.find(s => s.token === token);
    if (session) {
      const user = store.users.find(u => u.id === session.userId);
      if (user) req.user = user;
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
