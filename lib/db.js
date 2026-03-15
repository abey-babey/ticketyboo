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
    country          TEXT    NOT NULL DEFAULT 'UK',
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

// Add country column to events if it doesn't exist yet (Phase E migration)
try { db.exec("ALTER TABLE events ADD COLUMN country TEXT NOT NULL DEFAULT 'UK'"); } catch (_) { /* already present */ }

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

// ─── Seed events: re-seed when fewer than 10 events present (Phase E: 30-event catalogue) ─

const seedEventCheck = db.prepare('SELECT COUNT(*) AS cnt FROM events').get();
if (seedEventCheck.cnt < 10) {
  db.prepare('DELETE FROM events').run();
  const insertEvent = db.prepare(`
    INSERT INTO events (type, name, artist, venue, city, country, date, time, price, availableTickets, description, imageUrl)
    VALUES (@type, @name, @artist, @venue, @city, @country, @date, @time, @price, @availableTickets, @description, @imageUrl)
  `);
  const seedMany = db.transaction((evts) => { for (const e of evts) insertEvent.run(e); });

  seedMany([
    // Concerts
    { type: 'concert',    name: 'Rock Legends Live',               artist: 'The Thunder Band',          venue: 'O2 Arena',               city: 'London',           country: 'UK', date: '2026-03-21', time: '19:00', price:  65.00, availableTickets: 150, description: 'An unforgettable night of anthemic rock with The Thunder Band, playing hits spanning three decades.',                  imageUrl: 'https://picsum.photos/seed/tb-rock/600/400' },
    { type: 'concert',    name: 'Jazz in the Park',                 artist: 'Blue Note Quintet',         venue: 'Jam Cafe',               city: 'Nottingham',       country: 'UK', date: '2026-04-05', time: '20:30', price:  42.00, availableTickets:  80, description: 'An intimate evening of smooth jazz with the acclaimed Blue Note Quintet.',                                              imageUrl: 'https://picsum.photos/seed/bn-jazz/600/400' },
    { type: 'concert',    name: 'Folk by Firelight',                artist: 'Tara McAllen',              venue: 'The Sage Gateshead',     city: 'Gateshead',        country: 'UK', date: '2026-04-18', time: '19:00', price:  28.00, availableTickets: 120, description: 'Award-winning folk artist Tara McAllen performs her new album alongside fan favourites.',                               imageUrl: 'https://picsum.photos/seed/folk-fire/600/400' },
    { type: 'concert',    name: 'Classical Sundays',                artist: 'BBC Philharmonic',          venue: 'Bridgewater Hall',       city: 'Manchester',       country: 'UK', date: '2026-04-26', time: '15:00', price:  35.00, availableTickets: 200, description: 'An afternoon of Beethoven and Brahms performed by the world-renowned BBC Philharmonic Orchestra.',                   imageUrl: 'https://picsum.photos/seed/bbc-classical/600/400' },
    { type: 'concert',    name: 'Indie Freshers Mini-Fest',         artist: 'Various Artists',           venue: 'Rescue Rooms',           city: 'Nottingham',       country: 'UK', date: '2026-05-03', time: '18:00', price:  18.00, availableTickets:  60, description: 'Five up-and-coming indie acts share one stage for a high-energy showcase you will not forget.',                     imageUrl: 'https://picsum.photos/seed/indie-fest/600/400' },
    // Film Screenings
    { type: 'film',       name: 'The Godfather: 50th Anniversary',  artist: 'Francis Ford Coppola',      venue: 'Broadway Cinema',        city: 'Nottingham',       country: 'UK', date: '2026-03-28', time: '20:00', price:  12.50, availableTickets: 150, description: 'A landmark anniversary screening of the greatest gangster film ever made, restored to 4K.',                        imageUrl: 'https://picsum.photos/seed/godfather/600/400' },
    { type: 'film',       name: 'Sci-Fi Double Bill',               artist: 'Blade Runner & The Matrix', venue: 'Showcase Cinema',        city: 'Bristol',          country: 'UK', date: '2026-04-12', time: '18:00', price:  16.50, availableTickets: 100, description: 'Two groundbreaking sci-fi classics back-to-back on the big screen. Popcorn included.',                            imageUrl: 'https://picsum.photos/seed/scifi-bill/600/400' },
    { type: 'film',       name: 'Cult Horror Night',                artist: 'Psycho & The Shining',      venue: 'Hyde Park Picture House', city: 'Leeds',            country: 'UK', date: '2026-05-15', time: '19:30', price:  14.00, availableTickets:  80, description: 'A spine-chilling double bill of Hitchcock and Kubrick in a gloriously atmospheric old-school cinema.',              imageUrl: 'https://picsum.photos/seed/cult-horror/600/400' },
    // Comedy
    { type: 'comedy',     name: 'Stand-Up Spectacular',             artist: 'Sarah Johnson',             venue: 'The Comedy Store',       city: 'Manchester',       country: 'UK', date: '2026-03-29', time: '21:00', price:  28.00, availableTickets: 120, description: 'Sell-out comedian Sarah Johnson returns with an all-new hour of razor-sharp observational comedy.',               imageUrl: 'https://picsum.photos/seed/standup/600/400' },
    { type: 'comedy',     name: 'Improv Night',                     artist: 'The Comedy Crew',           venue: 'Komedia',                city: 'Bath',             country: 'UK', date: '2026-04-19', time: '19:30', price:  20.00, availableTickets:  60, description: 'Hilarious improvised comedy built entirely from audience suggestions. No two shows are ever the same!',          imageUrl: 'https://picsum.photos/seed/improv/600/400' },
    { type: 'comedy',     name: 'Late-Night Open Mic',              artist: 'Various Comedians',         venue: 'The Glee Club',          city: 'Birmingham',       country: 'UK', date: '2026-05-09', time: '20:00', price:  15.00, availableTickets:  80, description: 'Discover the next big thing in comedy. A packed bill of fresh faces taking their shot at the big time.',          imageUrl: 'https://picsum.photos/seed/open-mic/600/400' },
    // Festivals
    { type: 'festival',   name: 'Download Festival',                artist: 'Various Artists',           venue: 'Donington Park',         city: 'Castle Donington', country: 'UK', date: '2026-06-12', time: '12:00', price: 175.00, availableTickets: 200, description: 'The UK\'s premier rock and metal festival, returning to Donington Park for another unmissable weekend.',          imageUrl: 'https://picsum.photos/seed/download/600/400' },
    { type: 'festival',   name: 'Edinburgh Fringe Sampler',         artist: 'Various Artists',           venue: 'Various Venues',         city: 'Edinburgh',        country: 'UK', date: '2026-08-07', time: '10:00', price:  30.00, availableTickets: 100, description: 'A curated day pass giving access to five hand-picked shows from the world\'s greatest arts festival.',            imageUrl: 'https://picsum.photos/seed/fringe/600/400' },
    { type: 'festival',   name: 'Notts Food & Drink Festival',      artist: 'Various Chefs & Producers', venue: 'Market Square',          city: 'Nottingham',       country: 'UK', date: '2026-07-25', time: '11:00', price:   5.00, availableTickets: 250, description: 'Three days of street food, craft beer, cocktails and live music in the heart of Nottingham city centre.',        imageUrl: 'https://picsum.photos/seed/notts-food/600/400' },
    // Club Nights
    { type: 'club_night', name: 'Fabric: Drum & Bass All-Nighter',  artist: 'DJ Hype & Shy FX',          venue: 'Fabric',                 city: 'London',           country: 'UK', date: '2026-04-04', time: '22:00', price:  22.00, availableTickets: 300, description: 'London\'s legendary Fabric club hosts a six-hour drum & bass journey from two of the genre\'s greatest names.',  imageUrl: 'https://picsum.photos/seed/fabric-dnb/600/400' },
    { type: 'club_night', name: 'Hacien\u0302da Classical',         artist: 'Various DJs & Orchestra',   venue: 'Bridgewater Hall',       city: 'Manchester',       country: 'UK', date: '2026-05-23', time: '20:00', price:  35.00, availableTickets: 500, description: 'The iconic Hacien\u0302da club anthems reimagined live with a full orchestra. A genuinely unique experience.',       imageUrl: 'https://picsum.photos/seed/hacienda/600/400' },
    { type: 'club_night', name: 'Gatecrasher Reunion',              artist: 'Various DJs',               venue: 'O2 Academy',             city: 'Birmingham',       country: 'UK', date: '2026-06-06', time: '21:00', price:  25.00, availableTickets: 400, description: 'Relive the golden age of superclub culture as Gatecrasher brings back the biggest names of the 90s and 2000s.',  imageUrl: 'https://picsum.photos/seed/gatecrasher/600/400' },
    // Theatre
    { type: 'theatre',    name: 'Les Miserables',                   artist: 'Original West End Cast',    venue: 'Palace Theatre',         city: 'London',           country: 'UK', date: '2026-03-26', time: '19:30', price:  55.00, availableTickets: 250, description: 'Cameron Mackintosh\'s legendary production of Victor Hugo\'s epic masterpiece, direct from the West End.',       imageUrl: 'https://picsum.photos/seed/lesmis/600/400' },
    { type: 'theatre',    name: 'The Rocky Horror Show',            artist: 'Various Cast',              venue: 'Curve Theatre',          city: 'Leicester',        country: 'UK', date: '2026-04-24', time: '19:30', price:  38.00, availableTickets: 180, description: 'Come in costume and join the Time Warp at this gloriously camp, audience-participation riot of a show.',         imageUrl: 'https://picsum.photos/seed/rocky-horror/600/400' },
    // Comic Con & Fan Conventions
    { type: 'comicon',    name: 'MCM Comic Con',                    artist: 'Various Guests',            venue: 'ExCeL London',           city: 'London',           country: 'UK', date: '2026-05-30', time: '10:00', price:  28.00, availableTickets: 500, description: 'The UK\'s largest pop culture convention with celebrity guests, cosplay, gaming, comics and collectibles.',     imageUrl: 'https://picsum.photos/seed/mcm-comic/600/400' },
    { type: 'comicon',    name: 'Nottingham Comic Con',             artist: 'Various Guests',            venue: 'Motorpoint Arena',       city: 'Nottingham',       country: 'UK', date: '2026-07-11', time: '10:00', price:  20.00, availableTickets: 400, description: 'A brilliant day out for fans of comics, sci-fi, fantasy and anime in the East Midlands\' biggest arena.',       imageUrl: 'https://picsum.photos/seed/notts-comic/600/400' },
    { type: 'comicon',    name: 'EGX: Video Game Expo',             artist: 'Various Publishers',        venue: 'NEC Birmingham',         city: 'Birmingham',       country: 'UK', date: '2026-09-19', time: '10:00', price:  30.00, availableTickets: 600, description: 'The UK\'s number one video game event. Play upcoming releases, meet developers, and compete in tournaments.',    imageUrl: 'https://picsum.photos/seed/egx/600/400' },
    // Sporting Events
    { type: 'sport',      name: 'World Darts Championship',         artist: 'Finals Night',              venue: 'Alexandra Palace',       city: 'London',           country: 'UK', date: '2026-07-04', time: '19:00', price:  45.00, availableTickets: 300, description: 'The biggest night in darts. Two world-class players go head-to-head for the Sid Waddell Trophy at Ally Pally.',  imageUrl: 'https://picsum.photos/seed/darts/600/400' },
    { type: 'sport',      name: 'Cage Warriors MMA Night',          artist: 'Various Fighters',          venue: 'York Hall',              city: 'London',           country: 'UK', date: '2026-08-22', time: '18:00', price:  35.00, availableTickets: 200, description: 'Eight bouts of pulsating mixed martial arts action inside the iconic York Hall boxing venue in Bethnal Green.',  imageUrl: 'https://picsum.photos/seed/mma/600/400' },
    // Family Events
    { type: 'family',     name: 'Horrible Histories Live',          artist: 'Horrible Histories Cast',  venue: 'New Victoria Theatre',   city: 'Woking',           country: 'UK', date: '2026-04-11', time: '14:00', price:  24.00, availableTickets: 150, description: 'Terry Deary\'s icons take the stage! Rotten Romans, Vile Victorians and Groovy Greeks — all live and hilarious.',  imageUrl: 'https://picsum.photos/seed/horrible/600/400' },
    { type: 'family',     name: 'The Gruffalo on Stage',            artist: 'Tall Stories Theatre',     venue: 'Nottingham Playhouse',   city: 'Nottingham',       country: 'UK', date: '2026-05-16', time: '11:00', price:  16.50, availableTickets: 200, description: 'The beloved children\'s classic comes to life in this magical stage adaptation for ages 3 and up.',              imageUrl: 'https://picsum.photos/seed/gruffalo/600/400' },
    // Exhibitions
    { type: 'exhibition', name: 'David Hockney: A Bigger Picture',  artist: 'David Hockney',            venue: 'Royal Academy of Arts',  city: 'London',           country: 'UK', date: '2026-06-20', time: '10:00', price:  18.00, availableTickets: 300, description: 'A major retrospective of David Hockney\'s landscape paintings, from early Yorkshire scenes to tablet works.',     imageUrl: 'https://picsum.photos/seed/hockney/600/400' },
    // Food & Drink
    { type: 'food_drink', name: 'Great British Beer Festival',      artist: 'Various Brewers',          venue: 'Olympia London',         city: 'London',           country: 'UK', date: '2026-08-01', time: '11:00', price:  22.00, availableTickets: 400, description: 'CAMRA\'s flagship festival with over 900 real ales, ciders and perries from across the British Isles.',          imageUrl: 'https://picsum.photos/seed/beer-fest/600/400' },
    { type: 'food_drink', name: 'Nottingham Real Ale Trail',        artist: 'Various Pubs',             venue: 'Various Pubs',           city: 'Nottingham',       country: 'UK', date: '2026-09-12', time: '12:00', price:   5.00, availableTickets: 250, description: 'A self-guided trail through Nottingham\'s best real ale pubs, with a passport card stamped at each stop.',       imageUrl: 'https://picsum.photos/seed/ale-trail/600/400' },
    // Wellness
    { type: 'wellness',   name: 'Wilderness Yoga Retreat',          artist: 'Various Instructors',      venue: 'Wilderness Festival Site', city: 'Oxfordshire',    country: 'UK', date: '2026-07-18', time: '09:00', price: 125.00, availableTickets:  80, description: 'A full-day outdoor yoga, meditation and wellness retreat set in the beautiful Cornbury Park Estate.',            imageUrl: 'https://picsum.photos/seed/yoga/600/400' }
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
  getEventCities:      db.prepare("SELECT DISTINCT city FROM events WHERE city != '' ORDER BY city ASC"),
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

function getEventCities() {
  return stmts.getEventCities.all().map(r => r.city);
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
  getEventCities,
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
