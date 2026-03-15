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
`);

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

  // Helpers
  safeUser,

  // Lifecycle
  close
};
