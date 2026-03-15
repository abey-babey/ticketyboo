// ─── Auth middleware ──────────────────────────────────────────────────────────
// Validates the Bearer token on protected routes and attaches req.user.

const db = require('../lib/db');

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.substring(7);
  const session = db.getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const user = db.getUserById(session.userId);
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
    const session = db.getSession(token);
    if (session) {
      const user = db.getUserById(session.userId);
      if (user) req.user = user;
    }
  }
  next();
}

/**
 * Requires the authenticated user's role column to equal `role`.
 * Must be used after requireAuth.
 * Responds 403 Forbidden if the check fails.
 */
function requireRole(role) {
  return function (req, res, next) {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Requires the authenticated user to hold a specific permission string.
 * Must be used after requireAuth.
 * Responds 403 Forbidden if the check fails.
 */
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const perms = req.user.permissions || [];
    if (!perms.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole, requirePermission };
