# Ticketyboo — Development Roadmap 2026

## Overview

This document captures planned work across six areas of investment, building on the completed Phase 1 account-management work. Items are ordered by logical dependency; later phases assume earlier ones are in place.

---

## Phase A — README Refresh ✅

**Goal:** Bring the README up to date with everything built since the initial scaffold.

### A.1 What needs updating

| Section | Current state | Required update |
| --- | --- | --- |
| Feature list | Lists only browsing and purchasing | Add: user registration & login, My Account, password complexity, payment cards, guest checkout, 2FA (when shipped) |
| Event types | Mentions "concerts, films, comedy shows" | Update to reflect expanded catalogue (see Phase E) |
| API Endpoints | Lists only `/api/events` and `/api/tickets` | Add `/api/auth/*`, `/api/account/*` endpoints with request/response shapes |
| Prerequisites | Node v14+ | Bump to v18+ (LTS); note `nodemailer`, `bcryptjs`, `pdfkit`, `qrcode` dependencies |
| Running the app | Basic `npm start` | Add dev mode note; mention the Ethereal email preview URL printed at startup |
| Roles / permissions | Not mentioned | Document guest vs. authenticated user vs. administrator roles |
| Testing guidance | Generic Playwright hints | Add concrete examples against new auth and account endpoints |

### A.2 New sections to add

- **Architecture overview** — brief description of the `lib/`, `middleware/`, and `routes/` layout.
- **Environment variables** — `PORT` (default `3000`); SQLite DB path (Phase B); admin seed credentials (Phase C).
- **Roles** — Guest, Customer, Administrator.
- **API reference** — link to `docs/openapi.yaml` with instructions for loading it into Swagger UI or Postman.
- **Contributing / branch conventions** — one sentence pointing to the `copilot/` branch naming pattern already in use.

### A.3 OpenAPI specification ✅

A machine-readable OpenAPI 3.0.3 specification is maintained at `docs/openapi.yaml`.  It covers every current endpoint with full request/response schemas, error examples, and security definitions.  It can be:

- **Swagger UI** — drag-and-drop `docs/openapi.yaml` into [editor.swagger.io](https://editor.swagger.io) for interactive browsing and try-it-out.
- **Postman** — *Import → File → docs/openapi.yaml* to generate a ready-to-run collection with all example request bodies.
- **VS Code** — the [Swagger Viewer](https://marketplace.visualstudio.com/items?itemName=Arjun.swagger-viewer) extension renders it inline.
- **Playwright / any HTTP client** — use the schema definitions as the source of truth when building typed request helpers.

The spec is updated alongside each phase in this roadmap.

---

## Phase B — Persistent Lightweight Database (SQLite)

**Goal:** Replace the in-memory store with an embedded SQLite database so data survives server restarts without requiring a separate database process. The database file is created automatically on first start and removed cleanly on shutdown.

### B.1 Why SQLite

- Zero-install, zero-config, single-file database (`ticketyboo.db` in the project root).
- Started and stopped automatically with the Node process — no extra service to manage.
- Sufficient for a training app; trivially upgradeable to PostgreSQL later if needed.
- The `better-sqlite3` driver is synchronous, keeping route code readable without async/await sprawl.

### B.2 Schema

```sql
-- Users (maps 1:1 to current in-memory user model)
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    UNIQUE NOT NULL,
  customerEmail   TEXT    UNIQUE NOT NULL,
  passwordHash    TEXT    NOT NULL,
  title           TEXT,
  firstName       TEXT    NOT NULL,
  middleName      TEXT,
  lastName        TEXT    NOT NULL,
  knownAs         TEXT,
  gender          TEXT,
  phone           TEXT,
  addressLine1    TEXT,
  addressLine2    TEXT,
  postcode        TEXT,
  city            TEXT,
  county          TEXT,
  country         TEXT,
  marketingEmail  INTEGER DEFAULT 0,
  marketingSms    INTEGER DEFAULT 0,
  marketingPhone  INTEGER DEFAULT 0,
  marketingPost   INTEGER DEFAULT 0,
  twoFactorEnabled INTEGER DEFAULT 0,
  role            TEXT    DEFAULT 'customer',   -- 'customer' | 'admin'
  createdAt       TEXT    DEFAULT (datetime('now')),
  updatedAt       TEXT    DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE sessions (
  token     TEXT PRIMARY KEY,
  userId    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT DEFAULT (datetime('now'))
);

-- Payment cards (masked — full number never stored)
CREATE TABLE cards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  userId         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname       TEXT,
  cardholderName TEXT    NOT NULL,
  cardLast4      TEXT    NOT NULL,
  cardMasked     TEXT    NOT NULL,
  cardExpiry     TEXT    NOT NULL,
  createdAt      TEXT    DEFAULT (datetime('now'))
);

-- Events
CREATE TABLE events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  type             TEXT    NOT NULL,   -- see Phase E for full type list
  name             TEXT    NOT NULL,
  artist           TEXT,
  venue            TEXT    NOT NULL,
  city             TEXT    NOT NULL,
  country          TEXT    NOT NULL DEFAULT 'UK',
  date             TEXT    NOT NULL,
  time             TEXT    NOT NULL,
  price            REAL    NOT NULL,
  availableTickets INTEGER NOT NULL,
  description      TEXT,
  imageUrl         TEXT,
  createdAt        TEXT    DEFAULT (datetime('now'))
);

-- Purchases
CREATE TABLE purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  userId        INTEGER REFERENCES users(id),   -- NULL for guest purchases
  eventId       INTEGER NOT NULL REFERENCES events(id),
  customerName  TEXT    NOT NULL,
  customerEmail TEXT    NOT NULL,
  quantity      INTEGER NOT NULL,
  totalPrice    REAL    NOT NULL,
  createdAt     TEXT    DEFAULT (datetime('now'))
);

-- Application log (Phase C)
CREATE TABLE app_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  level     TEXT NOT NULL,   -- 'info' | 'warn' | 'error' | 'audit'
  category  TEXT NOT NULL,   -- 'auth' | 'purchase' | 'account' | 'admin' | 'support' | 'system'
  message   TEXT NOT NULL,
  userId    INTEGER REFERENCES users(id),
  meta      TEXT,            -- JSON blob for extra fields
  createdAt TEXT DEFAULT (datetime('now'))
);

-- Support tickets (Phase D)
CREATE TABLE support_tickets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  userId       INTEGER REFERENCES users(id),
  guestName    TEXT,
  guestEmail   TEXT,
  subject      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'resolved' | 'closed'
  priority     TEXT    NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
  createdAt    TEXT    DEFAULT (datetime('now')),
  updatedAt    TEXT    DEFAULT (datetime('now'))
);

-- Support messages (threaded replies on a ticket)
CREATE TABLE support_messages (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticketId  INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  authorId  INTEGER REFERENCES users(id),   -- NULL = guest initial message
  body      TEXT    NOT NULL,
  isAdmin   INTEGER DEFAULT 0,
  createdAt TEXT    DEFAULT (datetime('now'))
);
```

### B.3 Implementation steps

1. Add `better-sqlite3` to `package.json`.
2. Create `lib/db.js` — opens (or creates) the database, runs the `CREATE TABLE IF NOT EXISTS` migrations, and exports the `db` instance.
3. Add a graceful-shutdown hook in `server.js` (`process.on('SIGINT', ...)`) that calls `db.close()` so the WAL journal is flushed cleanly.
4. Replace `lib/store.js` (in-memory arrays) with thin DAO helpers in `lib/db.js` exposing `getUser`, `createUser`, `getEvents`, etc.
5. Update all route files (`auth.js`, `account.js`, `events.js`, `tickets.js`) to use the DAO helpers — route logic itself should not change significantly.
6. Seed the events table on first run using the existing event data (expanded in Phase E).
7. Seed admin accounts using an **upsert** strategy — on every server start, ensure the two seeded admin users exist with the correct role and permissions. Fixed known passwords are documented in the README. See Phase B.5 for the full seeding and permissions design.

### B.4 Files affected

`package.json`, `lib/db.js` (new), `lib/store.js` (retired), `server.js`, `routes/auth.js`, `routes/account.js`, `routes/events.js`, `routes/tickets.js`

---

## Phase B.5 — Granular Permissions System & Seeded Accounts

**Goal:** Replace the single `role` column with a proper permissions table, seed two fixed admin users on every startup (upsert), and add permission-aware middleware factories.

### B.5.1 Why granular permissions

A bare `role` string works for a two-tier guest/admin split but quickly becomes limiting:
- Some administrators should have read-only access (e.g. a support analyst who can view customers but not delete them).
- Future roles (e.g. event manager, support agent) need different permission subsets.
- Tests want to verify exact permission boundaries, not just broadly "is admin or not".

The `role` column is kept on `users` as a coarse category label (`'user'` or `'admin'`). Fine-grained access is driven by the `user_permissions` table.

### B.5.2 Schema additions

```sql
-- Granular permission grants (one row per user-permission pair)
CREATE TABLE IF NOT EXISTS user_permissions (
  userId     INTEGER NOT NULL,
  permission TEXT    NOT NULL,
  grantedAt  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (userId, permission),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

Permission names use a colon-separated namespace: `admin:users:read`, `admin:users:write`, `admin:users:delete`, `admin:events:write`, `admin:purchases:read`, `admin:logs:read`, `admin:support:write`.

### B.5.3 Seeded admin accounts

Two admin users are upserted on every server start (INSERT OR REPLACE), ensuring they always exist with the correct password hash, role, and permissions regardless of whether the database is fresh or pre-populated.

| Username | Password | Role | Permissions granted |
| --- | --- | --- | --- |
| `admin` | `AdminPass1!` | `admin` | All `admin:*` permissions |
| `admin.readonly` | `AdminRead1!` | `admin` | `admin:users:read`, `admin:purchases:read`, `admin:logs:read` |

Credentials are **fixed and documented in the README** — they are not random, and are not printed to the console. This makes it straightforward for test engineers to write scripts without any first-boot bootstrap step.

### B.5.4 DAO additions (`lib/db.js`)

| Function | Signature | Description |
| --- | --- | --- |
| `getUserPermissions` | `(userId) → string[]` | Returns all permission strings for the given user |
| `grantPermission` | `(userId, permission) → void` | Inserts a row into `user_permissions` (idempotent) |
| `revokePermission` | `(userId, permission) → void` | Deletes the row if present |
| `hasPermission` | `(userId, permission) → boolean` | Single-row existence check |

`getUserById` is updated to also attach a `permissions` array to the returned user object (same pattern as `savedCards`), so that `safeUser()` can include it without an extra query at the call site.

`safeUser()` is updated to expose `role` and `permissions: string[]` to API consumers.

`insertUser` prepared statement is updated to accept an explicit `role` value (still defaults to `'user'` for normal registrations).

### B.5.5 Middleware additions (`middleware/requireAuth.js`)

```js
// Requires the user to hold a specific permission string.
// Must be used after requireAuth.
function requirePermission(permission) { ... }

// Requires the user's role column to equal the given value.
// Useful for broad checks (e.g. requireRole('admin')).
function requireRole(role) { ... }
```

Both factories return a standard Express middleware `(req, res, next)` and respond with `403 Forbidden` on failure.

### B.5.6 Files affected

`lib/db.js` (schema, DAOs, upsert seed), `middleware/requireAuth.js` (new exports: `requirePermission`, `requireRole`), `README.md` (seeded credentials section)

---

## Phase C — Administration Panel

**Goal:** A restricted area accessible only to users with `role = 'admin'`. Administrators can monitor application health, review logs, and manage customers.

### C.1 Access control

- `requireRole('admin')` (from `middleware/requireAuth.js`, Phase B.5) guards the admin panel at the top level — any authenticated user without `role = 'admin'` gets a `403 Forbidden`.
- Individual admin endpoints may additionally require a specific permission via `requirePermission('admin:users:delete')` etc., allowing read-only admin accounts to access dashboards but not destructive operations.
- All `/api/admin/*` routes apply `requireAuth` + `requireRole('admin')` as a baseline and add sub-permission checks per endpoint.
- UI: a separate `/admin` HTML page served from `public/admin.html`. The page performs a `GET /api/auth/session` check on load and redirects to the main site if the user is not an admin.

### C.2 Dashboard — overview widgets

| Widget | Data source |
| --- | --- |
| Total registered users | `SELECT COUNT(*) FROM users WHERE role = 'customer'` |
| New registrations (last 7 days) | filtered by `createdAt` |
| Total purchases | `SELECT COUNT(*) FROM purchases` |
| Revenue (last 30 days) | `SELECT SUM(totalPrice) FROM purchases WHERE createdAt >= ?` |
| Open support tickets | `SELECT COUNT(*) FROM support_tickets WHERE status = 'open'` |
| Recent log warnings/errors | last 10 rows from `app_log` where `level IN ('warn','error')` |

### C.3 Application logs viewer

- Table view of `app_log`: timestamp, level (colour-coded badge), category, message, linked user.
- Filters: level, category, date range, free-text search.
- Live auto-refresh toggle (polls every 10 s).
- Export to CSV button.

**New API endpoints:**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/admin/logs` | Paginated log query with filter params (`level`, `category`, `from`, `to`, `q`, `page`, `limit`) |

### C.4 Customer management

- Searchable table of all registered customers: name, email, username, join date, purchase count.
- Click a customer row to open a customer detail panel:
  - Full profile (read-only view of all fields)
  - Purchase history for that customer
  - Support tickets raised by that customer
  - Account actions: **Suspend account**, **Reset password** (sends reset email), **Delete account**
  - Audit log filtered to that user

**New API endpoints:**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/admin/customers` | Paginated list with search (`q`, `page`, `limit`) |
| `GET` | `/api/admin/customers/:id` | Full profile + summary stats |
| `PUT` | `/api/admin/customers/:id/suspend` | Toggles `suspended` flag on user |
| `POST` | `/api/admin/customers/:id/reset-password` | Triggers password reset email |
| `DELETE` | `/api/admin/customers/:id` | Deletes account and all related data |

### C.5 Purchase tracking

- Full purchase list across all customers.
- Filters: date range, event, customer, ticket count range.
- Individual purchase detail with a re-issue confirmation button (logs the re-issue in `app_log`).

**New API endpoints:**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/admin/purchases` | Paginated + filtered purchases |
| `GET` | `/api/admin/purchases/:id` | Single purchase detail |

### C.6 Audit trail

- Every admin action (suspend, delete, password reset, log export) is written to `app_log` with `category = 'audit'` and the acting admin's `userId`.
- The admin panel log viewer can filter to `category = 'audit'` to show the full audit trail.

### C.7 Files

`public/admin.html` (new), `public/admin.js` (new), `public/admin.css` (new), `middleware/requireAdmin.js` (new), `routes/admin.js` (new), `lib/db.js` (log write helper), `server.js` (mount `routes/admin.js`)

---

## Phase D — Customer Support Flow

**Goal:** Customers (and guests) can raise support requests; administrators can read, respond to, and resolve them from the admin panel.

### D.1 Customer-facing flow

**Entry points:**

- "Get Help" link in the site footer and in the My Account modal.
- Direct link from a purchase confirmation: "Problem with your booking? Contact us".

**Support request form (shown in an overlay/modal):**

| Field | Notes |
| --- | --- |
| Subject | Required; dropdown with common categories + "Other" (see D.2) |
| Message | Required; free text, min 20 chars |
| Name | Pre-filled from account if logged in; required for guests |
| Email | Pre-filled from account if logged in; required for guests |
| Related booking ref | Optional; free text |
| Attachments | Phase D.2+ only — deferred |

On submit: `POST /api/support/tickets` — returns the new ticket ID and a confirmation message. Guests receive a reference by email (Ethereal); logged-in users see the ticket in their account.

#### My Tickets tab (Phase 2.2, My Account modal) — add sub-tab: Support History

- Lists all support tickets for the logged-in user: subject, status badge, last updated, "View thread" link.
- Clicking opens the full message thread in a modal.
- Customer can add a reply message to an open/in-progress ticket.

### D.2 Subject categories

- Booking & Tickets
- Payment & Refunds
- Account & Login
- Event Information
- Technical Issue
- Accessibility Request
- Complaint
- Other

### D.3 Admin-facing flow (Phase C — admin panel, new tab: "Support")

- Table of all tickets sorted by priority then age: ID, customer, subject, category, status, last updated.
- Status filter tabs: All · Open · In Progress · Resolved · Closed.
- Click a ticket row → full thread view:
  - All messages in chronological order (customer messages left-aligned, admin replies right-aligned).
  - Reply box for the admin.
  - Status dropdown (admin can change status).
  - Priority selector.
  - "Assign to me" / assignee field (Phase D.2+).
- Submitting a reply calls `POST /api/admin/support/:ticketId/reply`, which:
  - Saves the message.
  - Updates `updatedAt` on the ticket.
  - Sends a notification email to the customer via Ethereal (with preview URL logged).

### D.4 New API endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/support/tickets` | None | Create a new support ticket (guest or authenticated) |
| `GET` | `/api/support/tickets` | Required | List tickets for the logged-in customer |
| `GET` | `/api/support/tickets/:id` | Required | Get ticket + thread (customer must own it, or admin) |
| `POST` | `/api/support/tickets/:id/reply` | Required | Customer adds a reply to their own ticket |
| `GET` | `/api/admin/support` | Admin | Paginated/filtered ticket list |
| `PUT` | `/api/admin/support/:id` | Admin | Update status, priority |
| `POST` | `/api/admin/support/:id/reply` | Admin | Admin reply; triggers notification email |

### D.5 Files

`routes/support.js` (new), `public/index.html` (support modal + My Account sub-tab), `public/app.js` (support flow), `public/styles.css`, `public/admin.html` (support tab), `public/admin.js`, `lib/db.js` (support DAO helpers)

---

## Phase E — Expanded Event Catalogue

**Goal:** Broaden the range of events well beyond the original three types to make the application more realistic and interesting to test against.

### E.1 Event types

| Type key | Display name | Examples |
| --- | --- | --- |
| `concert` | Concert | Rock, Pop, Classical, Jazz, Metal, Folk |
| `film` | Film Screening | Classic cinema, cult nights, previews, marathons |
| `comedy` | Comedy | Stand-up, improv, sketch, open mic |
| `festival` | Festival | Music festivals, food & drink, arts, literary |
| `club_night` | Club Night | DJ sets, drum & bass, house, techno, 80s/90s nights |
| `theatre` | Theatre | Plays, musicals, pantomime, immersive theatre |
| `comicon` | Comic Con & Fan Conventions | Sci-fi, gaming, anime, horror, retro gaming |
| `sport` | Sporting Event | Boxing nights, wrestling, eSports, darts tournaments |
| `family` | Family Event | Pantomime, science shows, story-time, kids' cinema |
| `exhibition` | Exhibition & Museum | Art exhibitions, pop-up galleries, history shows |
| `food_drink` | Food & Drink | Beer festivals, street food markets, wine tasting |
| `wellness` | Wellness & Fitness | Yoga retreat, meditation day, a charity 5K |

### E.2 Sample events to seed (25–30 events spread across types and UK locations)

A representative selection — full seed data to be written in `lib/seed.js`:

| # | Type | Name | Venue | City |
| --- | --- | --- | --- | --- |
| 1 | concert | Rock Legends Live | O2 Arena | London |
| 2 | concert | Jazz in the Park | Jam Café | Nottingham |
| 3 | concert | Folk by Firelight | The Sage | Gateshead |
| 4 | concert | Classical Sundays | Bridgewater Hall | Manchester |
| 5 | concert | Indie Freshers Mini-Fest | Rescue Rooms | Nottingham |
| 6 | film | The Godfather: 50th Anniversary | Broadway Cinema | Nottingham |
| 7 | film | Sci-Fi Double Bill | Showcase Cinema | Bristol |
| 8 | film | Cult Horror Night | Hyde Park Picture House | Leeds |
| 9 | comedy | Stand-Up Spectacular | The Comedy Store | Manchester |
| 10 | comedy | Improv Night | Komedia | Bath |
| 11 | comedy | Late-Night Open Mic | The Glee Club | Birmingham |
| 12 | festival | Download Festival | Donington Park | Castle Donington |
| 13 | festival | Edinburgh Fringe Sampler | Various Venues | Edinburgh |
| 14 | festival | Notts Food & Drink Festival | Market Square | Nottingham |
| 15 | club_night | Fabric — Drum & Bass All-Nighter | Fabric | London |
| 16 | club_night | Haçienda Classical | Bridgewater Hall | Manchester |
| 17 | club_night | Gatecrasher Reunion | O2 Academy | Birmingham |
| 18 | theatre | Les Misérables | Palace Theatre | London |
| 19 | theatre | The Rocky Horror Show | Curve Theatre | Leicester |
| 20 | comicon | MCM Comic Con | ExCeL London | London |
| 21 | comicon | Nottingham Comic Con | Motorpoint Arena | Nottingham |
| 22 | comicon | EGX — Video Game Expo | NEC | Birmingham |
| 23 | sport | World Darts Championship | Alexandra Palace | London |
| 24 | sport | Cage Warriors — MMA Night | York Hall | London |
| 25 | family | Horrible Histories Live | New Victoria Theatre | Woking |
| 26 | family | The Gruffalo on Stage | Nottingham Playhouse | Nottingham |
| 27 | exhibition | David Hockney: A Bigger Picture | Royal Academy | London |
| 28 | food_drink | Great British Beer Festival | Olympia | London |
| 29 | food_drink | Nottingham Real Ale Trail | Various Pubs | Nottingham |
| 30 | wellness | Wilderness Yoga Retreat | Wilderness Festival Site | Oxfordshire |

### E.3 Event model additions

The `events` table (Phase B) gains two new fields compared to the in-memory model:

- `city TEXT NOT NULL` — used for Phase F location search.
- `imageUrl TEXT` — optional URL for an event image (placeholder images via `picsum.photos` for seed data).

### E.4 UI changes

- Event type filter updated from three buttons to a horizontal scrollable chip-strip (or a compact `<select>`) showing all types.
- Each event card gains a type badge (colour-coded by category) and a location line.
- Event detail modal adds the city/country and a "More events in this city" link.

---

## Phase F — Location Search & Filtering

**Goal:** Let users find events by city or region without needing to know the exact venue name.

### F.1 API changes

Extend `GET /api/events` query parameters:

| Param | Type | Description |
| --- | --- | --- |
| `type` | string | Existing filter — event type |
| `city` | string | Case-insensitive partial match on `city` field |
| `country` | string | Exact match on `country` field |
| `from` | date string | Events on or after this date (`YYYY-MM-DD`) |
| `to` | date string | Events on or before this date |
| `q` | string | Free-text search across `name`, `artist`, `venue`, `description` |
| `minPrice` | number | Min ticket price |
| `maxPrice` | number | Max ticket price |
| `page` | integer | Pagination (default 1) |
| `limit` | integer | Results per page (default 20, max 100) |

### F.2 UI changes

**Search & filter bar** — a collapsible panel above the event grid containing:

| Control | Purpose |
| --- | --- |
| Text search box | Maps to `q` param |
| City / Town input | Maps to `city` param (with autocomplete from known cities in the DB) |
| Type filter chips | Existing filter, retained |
| Date range pickers | From / To date fields |
| Price range slider | Min / Max price |
| "Reset filters" link | Clears all params and reloads |

**Results count** — "Showing 12 of 30 events" line above the grid, updated on filter change.

**No results state** — friendly "No events found matching your search" message with a "Clear filters" button.

### F.3 City autocomplete endpoint

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/events/cities` | Returns sorted list of distinct city values from the events table |

---

## Phase G — Additional Suggestions

These are lower-priority ideas that naturally complement the above work and add further testing surface.

### G.1 Waiting list / sold-out events

- When `availableTickets` reaches 0, the purchase button is replaced with "Join waiting list".
- `POST /api/tickets/waitlist` stores the customer's email against the event.
- When an admin manually increases `availableTickets` (via a new admin event-edit form), the first person on the waiting list is emailed via Ethereal.
- Good Playwright test scenario: verify the sold-out state, join the waiting list, verify confirmation.

### G.2 Event ratings & reviews

- After a purchase, the customer can leave a star rating (1–5) and a short review text.
- Reviews are displayed on the event card and detail modal with an average rating badge.
- Admin can moderate (hide) reviews from the admin panel.

### G.3 Promotional codes / discounts

- Admin can create a promo code (e.g. `FRINGE10` = 10% off all festival events).
- A "promo code" field appears at the bottom of the purchase form.
- Codes can have an expiry date, a max-use count, and optionally be scoped to a specific event type or event ID.

### G.4 Accessibility flag on events

- Boolean `isAccessible` field on events; filter checkbox labelled "Accessible venues only".
- Feeds into support category "Accessibility Request" (Phase D.2).

### G.5 Dark mode

- A toggle button in the header (sun/moon icon) switches between light and dark CSS custom-property themes.
- Preference stored in `localStorage`.

### G.6 Mobile-responsive improvements

- Current layout is desktop-first. Add proper responsive breakpoints for the event grid, modals, and the new admin panel.

### G.7 Favicon & site metadata

- Add a favicon (`public/favicon.ico` or SVG) so browser tabs and bookmarks show the Ticketyboo brand rather than a blank page icon.
- Add `<meta name="description">` and `<meta name="theme-color">` to `public/index.html`.
- Add Open Graph tags (`og:title`, `og:description`, `og:type`) for social sharing previews.

**Files:** `public/index.html`, `public/favicon.ico` (or `public/favicon.svg`)

---

## Dependency order / suggested implementation sequence

```text
A (README)  →  can be done any time, independent
B (SQLite)  →  do first; everything else builds on it
C (Admin)   →  depends on B
D (Support) →  depends on B and C (admin reply UI)
E (Events)  →  depends on B (seed script); UI changes are independent
F (Location)→  depends on B and E (city field on events)
G (extras)  →  pick opportunistically alongside D, E, F
```

---

## File inventory (new files introduced by this roadmap)

| File | Phase | Purpose |
| --- | --- | --- |
| `docs/openapi.yaml` | A | OpenAPI 3.0.3 specification — all current endpoints |
| `lib/db.js` | B | SQLite connection, schema migration, DAO helpers |
| `lib/seed.js` | B+E | First-run seed data (events); admin upsert runs inside `lib/db.js` on every start |
| `middleware/requireAuth.js` | B.5 | Extended with `requirePermission()` and `requireRole()` factory exports |
| `routes/admin.js` | C | `/api/admin/*` endpoints |
| `routes/support.js` | D | `/api/support/*` endpoints |
| `public/admin.html` | C | Admin panel SPA shell |
| `public/admin.js` | C | Admin panel JS |
| `public/admin.css` | C | Admin panel styles |

---

## Notes

- **Database file location** — `ticketyboo.db` in the project root. Add to `.gitignore` so test databases are not committed.
- **Migrations** — use `CREATE TABLE IF NOT EXISTS` for simplicity; no migration framework needed at this scale.
- **Seeded admin accounts** — two fixed admin users (`admin` / `AdminPass1!` and `admin.readonly` / `AdminRead1!`). Upserted on every server start so test suites can rely on them without any bootstrap step. Credentials are documented in the README; the plain-text passwords are purposely fixed and public for this training app.
- **No breaking changes to existing API contracts** — new query params are additive; existing clients continue to work.
- **Single-file front-end policy** — `public/app.js` remains consolidated for the customer-facing site. The admin panel gets its own `public/admin.js` to keep the concerns separate.
- **Playwright testing surface** — every new feature (admin login, support form, location filter, promo codes) is an additional automation scenario. This is a training app, so richness of testable flows is a feature in itself.
