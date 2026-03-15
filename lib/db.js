// ─── SQLite data layer ────────────────────────────────────────────────────────
// Single better-sqlite3 connection shared across the process.
// All public helpers are synchronous (better-sqlite3 design).

'use strict';

const path    = require('path');
const bcrypt   = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'ticketyboo.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema migrations ────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL UNIQUE,
    password         TEXT    NOT NULL,
    title            TEXT    NOT NULL DEFAULT '',
    firstName        TEXT    NOT NULL DEFAULT '',
    middleName       TEXT    NOT NULL DEFAULT '',
    lastName         TEXT    NOT NULL DEFAULT '',
    knownAs          TEXT    NOT NULL DEFAULT '',
    gender           TEXT    NOT NULL DEFAULT '',
    marketingPrefs   TEXT    NOT NULL DEFAULT '{"email":false,"sms":false,"phone":false,"post":false}',
    customerEmail    TEXT    NOT NULL UNIQUE,
    phone            TEXT    NOT NULL DEFAULT '',
    addressLine1     TEXT    NOT NULL DEFAULT '',
    addressLine2     TEXT    NOT NULL DEFAULT '',
    postcode         TEXT    NOT NULL DEFAULT '',
    city             TEXT    NOT NULL DEFAULT '',
    county           TEXT    NOT NULL DEFAULT '',
    country          TEXT    NOT NULL DEFAULT '',
    twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
    role             TEXT    NOT NULL DEFAULT 'user',
    createdAt        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT    PRIMARY KEY,
    userId    INTEGER NOT NULL,
    createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    userId          INTEGER NOT NULL,
    nickname        TEXT    NOT NULL DEFAULT '',
    cardholderName  TEXT    NOT NULL,
    cardLast4       TEXT    NOT NULL,
    cardMasked      TEXT    NOT NULL,
    cardExpiry      TEXT    NOT NULL,
    createdAt       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT    NOT NULL,
    name             TEXT    NOT NULL,
    artist           TEXT    NOT NULL DEFAULT '',
    venue            TEXT    NOT NULL DEFAULT '',
    date             TEXT    NOT NULL,
    time             TEXT    NOT NULL,
    price            REAL    NOT NULL DEFAULT 0,
    availableTickets INTEGER NOT NULL DEFAULT 0,
    description      TEXT    NOT NULL DEFAULT '',
    city             TEXT    NOT NULL DEFAULT '',
    imageUrl         TEXT    NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    userId        INTEGER,
    eventId       INTEGER NOT NULL,
    eventName     TEXT    NOT NULL DEFAULT '',
    quantity      INTEGER NOT NULL,
    customerName  TEXT    NOT NULL DEFAULT '',
    customerEmail TEXT    NOT NULL DEFAULT '',
    totalPrice    REAL    NOT NULL,
    cardholderName TEXT   NOT NULL DEFAULT '',
    cardLast4     TEXT    NOT NULL DEFAULT '',
    cardMasked    TEXT    NOT NULL DEFAULT '',
    purchaseDate  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (eventId)  REFERENCES events(id),
    FOREIGN KEY (userId)   REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS password_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    INTEGER NOT NULL,
    hash      TEXT    NOT NULL,
    createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    userId     INTEGER NOT NULL,
    permission TEXT    NOT NULL,
    grantedAt  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (userId, permission),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    level     TEXT NOT NULL,
    category  TEXT NOT NULL,
    message   TEXT NOT NULL,
    userId    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    meta      TEXT,
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userId       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    guestName    TEXT,
    guestEmail   TEXT,
    subject      TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'open',
    priority     TEXT    NOT NULL DEFAULT 'normal',
    createdAt    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updatedAt    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ticketId  INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    authorId  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body      TEXT    NOT NULL,
    isAdmin   INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

// Add suspended column to users if it doesn't exist yet (safe to run each start)
try { db.exec("ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0"); } catch (_) { /* already present */ }

// ─── Seeded admin accounts (upsert on every start) ─────────────────────────────

(function seedAdmins() {
  const ALL_PERMISSIONS = [
    'admin:users:read', 'admin:users:write', 'admin:users:delete',
    'admin:events:write', 'admin:purchases:read', 'admin:logs:read',
    'admin:support:write'
  ];
  const READONLY_PERMISSIONS = [
    'admin:users:read', 'admin:purchases:read', 'admin:logs:read'
  ];

  const admins = [
    { username: 'admin',          password: 'AdminPass1!', firstName: 'Admin',    lastName: 'User',     customerEmail: 'admin@ticketyboo.local',         role: 'admin', permissions: ALL_PERMISSIONS },
    { username: 'admin.readonly', password: 'AdminRead1!', firstName: 'Readonly', lastName: 'Admin',    customerEmail: 'admin.readonly@ticketyboo.local', role: 'admin', permissions: READONLY_PERMISSIONS }
  ];

  const upsertUser = db.prepare(`
    INSERT INTO users (username, password, firstName, lastName, customerEmail, role)
    VALUES (@username, @password, @firstName, @lastName, @customerEmail, @role)
    ON CONFLICT(username) DO UPDATE SET
      password      = excluded.password,
      customerEmail = excluded.customerEmail,
      role          = excluded.role
  `);

  const clearPerms  = db.prepare('DELETE FROM user_permissions WHERE userId = ?');
  const insertPerm  = db.prepare('INSERT OR IGNORE INTO user_permissions (userId, permission) VALUES (?, ?)');
  const findByName  = db.prepare('SELECT id FROM users WHERE username = ?');

  const seed = db.transaction(() => {
    for (const a of admins) {
      const hash = bcrypt.hashSync(a.password, 10);
      upsertUser.run({ ...a, password: hash });
      const { id } = findByName.get(a.username);
      clearPerms.run(id);
      for (const p of a.permissions) insertPerm.run(id, p);
    }
  });
  seed();
}());

// ─── Seed events (only when the table is empty) ───────────────────────────────

const seedEvents = db.prepare('SELECT COUNT(*) AS cnt FROM events').get();
if (seedEvents.cnt === 0) {
  const insertEvent = db.prepare(`
    INSERT INTO events (type, name, artist, venue, date, time, price, availableTickets, description)
    VALUES (@type, @name, @artist, @venue, @date, @time, @price, @availableTickets, @description)
  `);

  const seedMany = db.transaction((events) => {
    for (const e of events) insertEvent.run(e);
  });

  seedMany([
    { type: 'concert', name: 'Rock Legends Live',     artist: 'The Thunder Band',          venue: 'O2 Arena, London',               date: '2026-03-15', time: '19:00', price: 65.00, availableTickets: 150, description: 'Experience an unforgettable night of rock music with The Thunder Band!' },
    { type: 'film',    name: 'Classic Cinema Night',  artist: 'The Godfather',              venue: 'Broadway Cinema, Nottingham',    date: '2026-03-20', time: '20:00', price: 12.50, availableTickets: 200, description: 'Join us for a special screening of this timeless masterpiece.' },
    { type: 'comedy',  name: 'Stand-Up Spectacular',  artist: 'Sarah Johnson',              venue: 'The Comedy Store, Manchester',   date: '2026-03-25', time: '21:00', price: 28.00, availableTickets: 80,  description: 'Get ready to laugh until your sides hurt with Sarah Johnson!' },
    { type: 'concert', name: 'Jazz Night',            artist: 'Blue Note Quintet',          venue: 'Jam Café, Nottingham',           date: '2026-04-01', time: '20:30', price: 42.00, availableTickets: 100, description: 'An evening of smooth jazz with the acclaimed Blue Note Quintet.' },
    { type: 'film',    name: 'Sci-Fi Marathon',       artist: 'Blade Runner & The Matrix',  venue: 'Showcase Cinema, Bristol',       date: '2026-04-10', time: '18:00', price: 16.50, availableTickets: 120, description: 'Double feature of two groundbreaking sci-fi films.' },
    { type: 'comedy',  name: 'Improv Night',          artist: 'The Comedy Crew',             venue: 'Komedia, Bath',                  date: '2026-04-15', time: '19:30', price: 20.00, availableTickets: 60,  description: 'Hilarious improvised comedy based on audience suggestions!' }
  ]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseUser(row) {
  if (!row) return null;
  return {
    ...row,
    twoFactorEnabled: !!row.twoFactorEnabled,
    marketingPrefs: typeof row.marketingPrefs === 'string'
      ? JSON.parse(row.marketingPrefs)
      : row.marketingPrefs
  };
}

/**
 * Returns a user object safe to send to the client (password stripped).
 * @param {object} user  Raw user record (with savedCards already attached)
 */
function safeUser(user) {
  return {
    id:            user.id,
    username:      user.username,
    firstName:     user.firstName,
    middleName:    user.middleName   || '',
    lastName:      user.lastName,
    knownAs:       user.knownAs      || '',
    title:         user.title        || '',
    customerName:  (user.title && user.title !== 'prefer-not' ? user.title + ' ' : '') +
                   user.firstName +
                   (user.middleName ? ' ' + user.middleName : '') +
                   ' ' + user.lastName,
    gender:         user.gender         || '',
    marketingPrefs: user.marketingPrefs || { email: false, sms: false, phone: false, post: false },
    customerEmail:  user.customerEmail,
    phone:          user.phone          || '',
    addressLine1:   user.addressLine1   || '',
    addressLine2:   user.addressLine2   || '',
    postcode:       user.postcode       || '',
    city:           user.city           || '',
    county:         user.county         || '',
    country:        user.country        || '',
    suspended:       !!user.suspended,
    twoFactorEnabled: !!user.twoFactorEnabled,
    role:        user.role        || 'user',
    permissions: user.permissions || [],
    savedCards: (user.savedCards || []).map(c => ({
      id:             c.id,
      nickname:       c.nickname,
      cardholderName: c.cardholderName,
      cardLast4:      c.cardLast4,
      cardMasked:     c.cardMasked,
      cardExpiry:     c.cardExpiry,
      createdAt:      c.createdAt
    }))
  };
}

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  // Users
  getUserById:         db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByUsername:   db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserByEmail:      db.prepare('SELECT * FROM users WHERE customerEmail = ?'),
  getUserByUsernameAndEmail: db.prepare('SELECT * FROM users WHERE username = ? AND customerEmail = ?'),
  insertUser: db.prepare(`
    INSERT INTO users
      (username, password, title, firstName, middleName, lastName, knownAs, gender,
       marketingPrefs, customerEmail, phone, addressLine1, addressLine2,
       postcode, city, county, country, twoFactorEnabled, role)
    VALUES
      (@username, @password, @title, @firstName, @middleName, @lastName, @knownAs, @gender,
       @marketingPrefs, @customerEmail, @phone, @addressLine1, @addressLine2,
       @postcode, @city, @county, @country, @twoFactorEnabled, @role)
  `),

  // Permissions
  getPermsByUser:    db.prepare('SELECT permission FROM user_permissions WHERE userId = ? ORDER BY permission ASC'),
  insertPermission:  db.prepare('INSERT OR IGNORE INTO user_permissions (userId, permission) VALUES (?, ?)'),
  deletePermission:  db.prepare('DELETE FROM user_permissions WHERE userId = ? AND permission = ?'),
  checkPermission:   db.prepare('SELECT 1 FROM user_permissions WHERE userId = ? AND permission = ?'),

  // Sessions
  getSession:    db.prepare('SELECT * FROM sessions WHERE token = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, userId) VALUES (?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),

  // Cards
  getCardsByUser: db.prepare('SELECT * FROM cards WHERE userId = ? ORDER BY createdAt ASC'),
  insertCard: db.prepare(`
    INSERT INTO cards (userId, nickname, cardholderName, cardLast4, cardMasked, cardExpiry)
    VALUES (@userId, @nickname, @cardholderName, @cardLast4, @cardMasked, @cardExpiry)
  `),
  deleteCard: db.prepare('DELETE FROM cards WHERE id = ? AND userId = ?'),

  // Events
  getAllEvents:         db.prepare('SELECT * FROM events ORDER BY date ASC'),
  getEventsByType:     db.prepare('SELECT * FROM events WHERE type = ? ORDER BY date ASC'),
  getEventById:        db.prepare('SELECT * FROM events WHERE id = ?'),
  decrementTickets:    db.prepare('UPDATE events SET availableTickets = availableTickets - ? WHERE id = ? AND availableTickets >= ?'),

  // Purchases
  getAllPurchases:      db.prepare('SELECT * FROM purchases ORDER BY purchaseDate DESC'),
  getPurchaseById:     db.prepare('SELECT * FROM purchases WHERE id = ?'),
  getPurchasesByUser:  db.prepare('SELECT * FROM purchases WHERE userId = ? ORDER BY purchaseDate DESC'),
  insertPurchase: db.prepare(`
    INSERT INTO purchases
      (userId, eventId, eventName, quantity, customerName, customerEmail,
       totalPrice, cardholderName, cardLast4, cardMasked, purchaseDate)
    VALUES
      (@userId, @eventId, @eventName, @quantity, @customerName, @customerEmail,
       @totalPrice, @cardholderName, @cardLast4, @cardMasked, @purchaseDate)
  `),

  // Password history
  getPasswordHistory: db.prepare(
    'SELECT hash FROM password_history WHERE userId = ? ORDER BY createdAt DESC LIMIT 5'
  ),
  insertPasswordHistory: db.prepare(
    'INSERT INTO password_history (userId, hash) VALUES (?, ?)'
  ),
  prunePasswordHistory: db.prepare(`
    DELETE FROM password_history
    WHERE userId = ?
      AND id NOT IN (
        SELECT id FROM password_history WHERE userId = ? ORDER BY createdAt DESC LIMIT 5
      )
  `),

  // App log
  insertLog: db.prepare(`
    INSERT INTO app_log (level, category, message, userId, meta)
    VALUES (@level, @category, @message, @userId, @meta)
  `)
};

// ─── DAO functions ────────────────────────────────────────────────────────────

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * Returns full user row (parsed) with savedCards and permissions attached, or null.
 */
function getUserById(id) {
  const row = stmts.getUserById.get(id);
  if (!row) return null;
  const user = parseUser(row);
  user.savedCards   = stmts.getCardsByUser.all(id);
  user.permissions  = stmts.getPermsByUser.all(id).map(r => r.permission);
  return user;
}

/**
 * Returns raw user row (with password) for auth use, or null.
 */
function getUserByUsername(username) {
  return parseUser(stmts.getUserByUsername.get(username));
}

/**
 * Returns raw user row (with password) for auth use, or null.
 */
function getUserByEmail(email) {
  return parseUser(stmts.getUserByEmail.get(email));
}

/**
 * Returns raw user row for password-reset use (matches both username + email), or null.
 */
function getUserByUsernameAndEmail(username, email) {
  return parseUser(stmts.getUserByUsernameAndEmail.get(username, email));
}

/**
 * Creates a new user record and returns the new row id.
 */
function createUser(data) {
  const params = {
    username:         data.username,
    password:         data.password,
    title:            data.title            || '',
    firstName:        data.firstName        || '',
    middleName:       data.middleName       || '',
    lastName:         data.lastName         || '',
    knownAs:          data.knownAs          || '',
    gender:           data.gender           || '',
    marketingPrefs:   JSON.stringify(data.marketingPrefs || { email: false, sms: false, phone: false, post: false }),
    customerEmail:    data.customerEmail,
    phone:            data.phone            || '',
    addressLine1:     data.addressLine1     || '',
    addressLine2:     data.addressLine2     || '',
    postcode:         data.postcode         || '',
    city:             data.city             || '',
    county:           data.county           || '',
    country:          data.country          || '',
    twoFactorEnabled: data.twoFactorEnabled ? 1 : 0,
    role:             data.role || 'user'
  };
  return stmts.insertUser.run(params).lastInsertRowid;
}

// ── Permissions ───────────────────────────────────────────────────────────────

/** Returns all permission strings for the given user. */
function getUserPermissions(userId) {
  return stmts.getPermsByUser.all(userId).map(r => r.permission);
}

/** Inserts a permission row (idempotent). */
function grantPermission(userId, permission) {
  stmts.insertPermission.run(userId, permission);
}

/** Removes a permission row if present. */
function revokePermission(userId, permission) {
  stmts.deletePermission.run(userId, permission);
}

/** Returns true if the user holds the given permission. */
function hasPermission(userId, permission) {
  return !!stmts.checkPermission.get(userId, permission);
}

/**
 * Updates one or more fields on a user record.
 * Only keys present in `fields` are updated (dynamic SET clause).
 */
function updateUser(id, fields) {
  const allowed = [
    'username', 'password', 'title', 'firstName', 'middleName', 'lastName',
    'knownAs', 'gender', 'marketingPrefs', 'customerEmail', 'phone',
    'addressLine1', 'addressLine2', 'postcode', 'city', 'county', 'country',
    'twoFactorEnabled', 'role'
  ];

  const updates = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      if (key === 'marketingPrefs') {
        updates[key] = typeof fields[key] === 'string' ? fields[key] : JSON.stringify(fields[key]);
      } else if (key === 'twoFactorEnabled') {
        updates[key] = fields[key] ? 1 : 0;
      } else {
        updates[key] = fields[key];
      }
    }
  }

  if (Object.keys(updates).length === 0) return;

  const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = @_id`).run({ ...updates, _id: id });
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function getSession(token) {
  return stmts.getSession.get(token) || null;
}

function createSession(token, userId) {
  stmts.insertSession.run(token, userId);
}

function deleteSession(token) {
  stmts.deleteSession.run(token);
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function getCardsByUser(userId) {
  return stmts.getCardsByUser.all(userId);
}

/**
 * Inserts a card and returns the full card row (with generated id and createdAt).
 */
function createCard(userId, data) {
  const params = {
    userId,
    nickname:       data.nickname       || '',
    cardholderName: data.cardholderName,
    cardLast4:      data.cardLast4,
    cardMasked:     data.cardMasked,
    cardExpiry:     data.cardExpiry
  };
  const id = stmts.insertCard.run(params).lastInsertRowid;
  return db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
}

/**
 * Deletes a card belonging to the given user. Returns number of rows deleted.
 */
function deleteCard(cardId, userId) {
  return stmts.deleteCard.run(cardId, userId).changes;
}

// ── Events ────────────────────────────────────────────────────────────────────

function getEvents(type) {
  return type ? stmts.getEventsByType.all(type) : stmts.getAllEvents.all();
}

function getEventById(id) {
  return stmts.getEventById.get(id) || null;
}

/**
 * Atomically decrements availableTickets. Throws if tickets are insufficient.
 */
function decrementTickets(eventId, qty) {
  const result = stmts.decrementTickets.run(qty, eventId, qty);
  if (result.changes === 0) {
    throw new Error('Not enough tickets available.');
  }
}

// ── Purchases ─────────────────────────────────────────────────────────────────

function getAllPurchases() {
  return stmts.getAllPurchases.all();
}

function getPurchaseById(id) {
  return stmts.getPurchaseById.get(id) || null;
}

function getPurchasesByUser(userId) {
  return stmts.getPurchasesByUser.all(userId);
}

/**
 * Creates a purchase and returns the generated id.
 */
function createPurchase(data) {
  const params = {
    userId:        data.userId        || null,
    eventId:       data.eventId,
    eventName:     data.eventName     || '',
    quantity:      data.quantity,
    customerName:  data.customerName  || '',
    customerEmail: data.customerEmail || '',
    totalPrice:    data.totalPrice,
    cardholderName: data.cardholderName || '',
    cardLast4:     data.cardLast4     || '',
    cardMasked:    data.cardMasked    || '',
    purchaseDate:  data.purchaseDate  || new Date().toISOString()
  };
  return stmts.insertPurchase.run(params).lastInsertRowid;
}

// ── Admin: app_log ────────────────────────────────────────────────────────────

/**
 * Writes a structured log entry.
 * @param {'info'|'warn'|'error'|'audit'} level
 * @param {'auth'|'purchase'|'account'|'admin'|'support'|'system'} category
 * @param {string} message
 * @param {number|null} [userId]
 * @param {object|null} [meta]
 */
function writeLog(level, category, message, userId = null, meta = null) {
  stmts.insertLog.run({
    level,
    category,
    message,
    userId: userId || null,
    meta:   meta ? JSON.stringify(meta) : null
  });
}

/**
 * Queries app_log with optional filters. Returns { rows, total, page, limit }.
 */
function getLogs({ level, category, from, to, q, page = 1, limit = 50 } = {}) {
  const conditions = [];
  const params     = [];

  if (level)    { conditions.push('l.level = ?');                           params.push(level); }
  if (category) { conditions.push('l.category = ?');                        params.push(category); }
  if (from)     { conditions.push('l.createdAt >= ?');                      params.push(from); }
  if (to)       { conditions.push('l.createdAt <= ?');                      params.push(to + 'T23:59:59Z'); }
  if (q)        { conditions.push('(l.message LIKE ? OR l.category LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(limit);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM app_log l ${where}`).get(...params).cnt;
  const rows  = db.prepare(
    `SELECT l.*, u.username FROM app_log l
     LEFT JOIN users u ON l.userId = u.id
     ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), offset);

  return { rows, total, page: Number(page), limit: Number(limit) };
}

// ── Admin: dashboard stats ────────────────────────────────────────────────────

function getDashboardStats() {
  const sevenDaysAgo  = new Date(Date.now() - 7  * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  return {
    totalUsers:        db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get().n,
    newUsersLast7:     db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user' AND createdAt >= ?").get(sevenDaysAgo).n,
    totalPurchases:    db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n,
    revenueLast30:     db.prepare('SELECT COALESCE(SUM(totalPrice),0) AS n FROM purchases WHERE purchaseDate >= ?').get(thirtyDaysAgo).n,
    recentLogWarnings: db.prepare("SELECT * FROM app_log WHERE level IN ('warn','error') ORDER BY id DESC LIMIT 10").all()
  };
}

// ── Admin: customer management ────────────────────────────────────────────────

function getCustomers({ q, page = 1, limit = 20 } = {}) {
  const offset = (Number(page) - 1) * Number(limit);
  const search = q ? '%' + q + '%' : null;
  const where  = search
    ? "WHERE u.role = 'user' AND (u.username LIKE ? OR u.customerEmail LIKE ? OR u.firstName LIKE ? OR u.lastName LIKE ?)"
    : "WHERE u.role = 'user'";
  const qParams = search ? [search, search, search, search] : [];

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM users u ${where}`).get(...qParams).cnt;
  const rows  = db.prepare(
    `SELECT u.id, u.username, u.firstName, u.lastName, u.customerEmail, u.createdAt, u.suspended,
            COUNT(p.id) AS purchaseCount
     FROM users u
     LEFT JOIN purchases p ON p.userId = u.id
     ${where}
     GROUP BY u.id
     ORDER BY u.createdAt DESC
     LIMIT ? OFFSET ?`
  ).all(...qParams, Number(limit), offset);

  return { rows, total, page: Number(page), limit: Number(limit) };
}

function getCustomerDetail(id) {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(id);
  if (!user) return null;
  const parsed        = parseUser(user);
  parsed.savedCards   = stmts.getCardsByUser.all(id);
  parsed.permissions  = stmts.getPermsByUser.all(id).map(r => r.permission);
  parsed.purchases    = stmts.getPurchasesByUser.all(id);
  parsed.purchaseCount = parsed.purchases.length;
  parsed.totalSpend   = parsed.purchases.reduce((s, p) => s + p.totalPrice, 0);
  parsed.recentLog    = db.prepare('SELECT * FROM app_log WHERE userId = ? ORDER BY id DESC LIMIT 20').all(id);
  return parsed;
}

function toggleSuspend(id) {
  db.prepare("UPDATE users SET suspended = CASE WHEN suspended = 0 THEN 1 ELSE 0 END WHERE id = ? AND role = 'user'").run(id);
  return db.prepare('SELECT suspended FROM users WHERE id = ?').get(id);
}

function deleteUser(id) {
  return db.prepare("DELETE FROM users WHERE id = ? AND role = 'user'").run(id).changes;
}

// ── Admin: purchases (paginated + filtered) ───────────────────────────────────

function getAdminPurchases({ from, to, eventId, userId, q, page = 1, limit = 20 } = {}) {
  const conditions = [];
  const params     = [];

  if (from)    { conditions.push('p.purchaseDate >= ?');                               params.push(from); }
  if (to)      { conditions.push('p.purchaseDate <= ?');                               params.push(to + 'T23:59:59Z'); }
  if (eventId) { conditions.push('p.eventId = ?');                                     params.push(Number(eventId)); }
  if (userId)  { conditions.push('p.userId = ?');                                      params.push(Number(userId)); }
  if (q)       { conditions.push('(p.customerName LIKE ? OR p.customerEmail LIKE ? OR p.eventName LIKE ?)');
                 params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(limit);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM purchases p ${where}`).get(...params).cnt;
  const rows  = db.prepare(
    `SELECT p.*, u.username FROM purchases p
     LEFT JOIN users u ON p.userId = u.id
     ${where} ORDER BY p.purchaseDate DESC LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), offset);

  return { rows, total, page: Number(page), limit: Number(limit) };
}

// ── Password history ──────────────────────────────────────────────────────────

/**
 * Returns an array of the last 5 password hashes for the given user.
 */
function getPasswordHistory(userId) {
  return stmts.getPasswordHistory.all(userId).map(r => r.hash);
}

/**
 * Adds a hash to the user's password history and trims to the 5 most recent.
 */
function addPasswordHistory(userId, hash) {
  stmts.insertPasswordHistory.run(userId, hash);
  stmts.prunePasswordHistory.run(userId, userId);
}

// ── Support tickets ───────────────────────────────────────────────────────────

/**
 * Creates a new support ticket and its first message.
 * Returns the new ticket object.
 */
function createSupportTicket({ userId = null, guestName = null, guestEmail = null, subject, initialMessage }) {
  const insert = db.transaction(() => {
    const ticket = db.prepare(
      `INSERT INTO support_tickets (userId, guestName, guestEmail, subject)
       VALUES (?, ?, ?, ?)`
    ).run(userId, guestName, guestEmail, subject);
    const ticketId = ticket.lastInsertRowid;
    db.prepare(
      `INSERT INTO support_messages (ticketId, authorId, body, isAdmin) VALUES (?, ?, ?, 0)`
    ).run(ticketId, userId, initialMessage);
    return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
  });
  return insert();
}

/**
 * Returns all tickets for a given registered user, newest first.
 */
function getSupportTicketsByUser(userId) {
  return db.prepare(
    `SELECT t.*,
       (SELECT COUNT(*) FROM support_messages WHERE ticketId = t.id) AS messageCount
     FROM support_tickets t
     WHERE t.userId = ?
     ORDER BY t.updatedAt DESC`
  ).all(userId);
}

/**
 * Returns a single ticket with its message thread.
 * Returns null if not found.
 */
function getSupportTicketDetail(id) {
  const ticket = db.prepare(
    `SELECT t.*, u.username, u.customerEmail AS userEmail
     FROM support_tickets t
     LEFT JOIN users u ON t.userId = u.id
     WHERE t.id = ?`
  ).get(id);
  if (!ticket) return null;
  ticket.messages = db.prepare(
    `SELECT m.*, u.username AS authorName
     FROM support_messages m
     LEFT JOIN users u ON m.authorId = u.id
     WHERE m.ticketId = ?
     ORDER BY m.createdAt ASC`
  ).all(id);
  return ticket;
}

/**
 * Adds a reply message to a ticket and updates its updatedAt.
 * Returns the new message row.
 */
function addSupportMessage(ticketId, authorId, body, isAdmin) {
  const result = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO support_messages (ticketId, authorId, body, isAdmin) VALUES (?, ?, ?, ?)`
    ).run(ticketId, authorId || null, body, isAdmin ? 1 : 0);
    db.prepare(`UPDATE support_tickets SET updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(ticketId);
    return db.prepare('SELECT * FROM support_messages WHERE id = ?').get(ins.lastInsertRowid);
  });
  return result();
}

/**
 * Updates status and/or priority on a ticket.
 */
function updateSupportTicket(id, { status, priority } = {}) {
  const sets = [];
  const params = [];
  if (status)   { sets.push('status = ?');   params.push(status); }
  if (priority) { sets.push('priority = ?'); params.push(priority); }
  if (!sets.length) return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  sets.push("updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
}

/**
 * Paginated admin view of all support tickets with optional filters.
 */
function getAdminSupportTickets({ status, priority, q, page = 1, limit = 20 } = {}) {
  const conditions = [];
  const params     = [];

  if (status && status !== 'all') { conditions.push('t.status = ?');   params.push(status); }
  if (priority)                   { conditions.push('t.priority = ?'); params.push(priority); }
  if (q) {
    conditions.push('(t.subject LIKE ? OR u.username LIKE ? OR t.guestName LIKE ? OR t.guestEmail LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (Number(page) - 1) * Number(limit);

  const total = db.prepare(
    `SELECT COUNT(*) AS cnt FROM support_tickets t LEFT JOIN users u ON t.userId = u.id ${where}`
  ).get(...params).cnt;

  const rows = db.prepare(
    `SELECT t.*,
       COALESCE(u.username, t.guestName) AS displayName,
       COALESCE(u.customerEmail, t.guestEmail) AS displayEmail,
       (SELECT COUNT(*) FROM support_messages WHERE ticketId = t.id) AS messageCount
     FROM support_tickets t
     LEFT JOIN users u ON t.userId = u.id
     ${where}
     ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
              t.updatedAt ASC
     LIMIT ? OFFSET ?`
  ).all(...params, Number(limit), offset);

  return { rows, total, page: Number(page), limit: Number(limit) };
}

// ─── Graceful close ───────────────────────────────────────────────────────────

function close() {
  db.close();
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Users
  getUserById,
  getUserByUsername,
  getUserByEmail,
  getUserByUsernameAndEmail,
  createUser,
  updateUser,

  // Sessions
  getSession,
  createSession,
  deleteSession,

  // Cards
  getCardsByUser,
  createCard,
  deleteCard,

  // Events
  getEvents,
  getEventById,
  decrementTickets,

  // Purchases
  getAllPurchases,
  getPurchaseById,
  getPurchasesByUser,
  createPurchase,

  // Password history
  getPasswordHistory,
  addPasswordHistory,

  // Permissions
  getUserPermissions,
  grantPermission,
  revokePermission,
  hasPermission,

  // App log
  writeLog,
  getLogs,

  // Support
  createSupportTicket,
  getSupportTicketsByUser,
  getSupportTicketDetail,
  addSupportMessage,
  updateSupportTicket,
  getAdminSupportTickets,

  // Admin stats & management
  getDashboardStats,
  getCustomers,
  getCustomerDetail,
  toggleSuspend,
  deleteUser,
  getAdminPurchases,

  // Helpers
  safeUser,

  // Lifecycle
  close
};
