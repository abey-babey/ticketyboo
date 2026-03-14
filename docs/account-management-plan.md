# Account Management & Registration Enhancement — Plan

## Overview

This document tracks the planned, in-progress, and completed work to add a "Your Account" feature, enhanced registration, password complexity, password reset, and (in a later phase) purchase history and ticket downloads to Ticketyboo.

---

## Phase 1 — Account Management & Registration

### ✅ Completed

#### 1.1 Extended User Model & Registration Form

The user data model has been expanded from a minimal auth record to a full customer profile.

**New fields added to `server.js`:**

| Field | Type | Required |
|---|---|---|
| `title` | string | No |
| `firstName` | string | Yes |
| `middleName` | string | No |
| `lastName` | string | Yes |
| `knownAs` | string | No |
| `gender` | string | No |
| `marketingPrefs.email` | boolean | No |
| `marketingPrefs.sms` | boolean | No |
| `marketingPrefs.phone` | boolean | No |
| `marketingPrefs.post` | boolean | No |
| `customerEmail` | email | Yes |
| `username` | string | Yes |
| `password` | string | Yes |
| `phone` | string | No |
| `addressLine1` | string | No |
| `addressLine2` | string | No |
| `postcode` | string | No |
| `city` | string | No |
| `county` | string | No |
| `country` | string | No |

- `safeUser()` helper added to `server.js` — strips the password before sending user data to the client; used consistently in `POST /api/auth/register`, `POST /api/auth/login`, and `GET /api/auth/session`.
- Registration form in `public/index.html` extended with the new address fields (phone, address line 1 & 2, postcode, city/town, county, country).
- `handleRegister()` in `public/app.js` updated to collect and submit all new fields.
- Address fields are optional at registration; all default to empty string if not provided.

#### 1.2 UI Fixes

- Fixed a CSS scoping bug on `.auth-warning strong` that was causing the Training Application Notice banner text to break incorrectly (inline `<strong>` was being rendered as a block element, orphaning punctuation).
- Heading `<strong>` given class `auth-warning__title`; CSS rule tightened to `.auth-warning .auth-warning__title`.

#### 1.3 Password Complexity

Password complexity rules enforced on registration (`POST /api/auth/register`).

**Rules:**

| Rule | Detail |
|---|---|
| Minimum length | 8 characters |
| Uppercase | At least 1 character A–Z |
| Lowercase | At least 1 character a–z |
| Number | At least 1 digit 0–9 |
| Special character | At least 1 of: `! @ # $ % ^ & *` |

**Implementation:**

- **Client-side** — `validatePassword(password)` utility + `updatePasswordChecklist(value)` in `public/app.js`. Live ✓/✗ checklist rendered beneath the password field as the user types; `handleRegister()` blocks submission until all rules pass.
- **Server-side** — `validatePasswordComplexity(password)` in `server.js`; called in `POST /api/auth/register` and returns `400` with a descriptive message if any rule is violated.
- Password change (1.4) and password reset confirmation (1.5) will reuse the same validators.

**Files changed:** `server.js`, `public/app.js`, `public/index.html`, `public/styles.css`

---

#### 1.4 My Account Modal & Payment Cards ✅

A **My Account** button added to the header alongside Sign Out. Opens a modal with three tabs.

**Header change:**
```
Welcome, [Name]   [My Account]   [Sign Out]
```

**Tab 1 — Profile**

Displays and allows editing of:
- Title, First Name, Middle Name, Last Name, Known As
- Email Address
- Phone Number
- Address Line 1 / 2, Postcode, City / Town, County, Country

Save button calls `PUT /api/account`. Shows inline success/error feedback.

**Tab 2 — Security**

- Change username (validates uniqueness on save, calls `PUT /api/account` with new username)
- Change password:
  - Current Password
  - New Password (with real-time strength indicator — reuses 1.3 validators)
  - Confirm New Password

Password change calls `PUT /api/account/password` (requires current password to be correct).

**Tab 3 — Payment Cards**

Saved payment cards. The full card number is never stored — only the last four digits and expiry date are kept.

- List of saved cards (nickname, masked number, cardholder name, expiry, Remove button)
- Add a new card form:
  - Nickname (optional label, e.g. "My Visa", "Work Card")
  - Card Number (validated, masked on save)
  - Expiry Date (MM/YY — validated, not in the past)
  - Cardholder Name
- Remove card button calls `DELETE /api/account/cards/:cardId`

**New API endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/account` | Required | Returns full profile of logged-in user |
| `PUT` | `/api/account` | Required | Updates profile fields; optionally updates username (validates uniqueness) |
| `PUT` | `/api/account/password` | Required | Changes password; requires `currentPassword` in body |
| `GET` | `/api/account/cards` | Required | Returns list of saved cards (masked) |
| `POST` | `/api/account/cards` | Required | Saves a new card (validates card details; stores masked version only) |
| `DELETE` | `/api/account/cards/:cardId` | Required | Removes a saved card |

**Card data model (stored per user, never includes full card number or CVV):**

| Field | Notes |
|---|---|
| `id` | Auto-incrementing integer |
| `nickname` | Optional label chosen by the user |
| `cardholderName` | Stored as uppercase |
| `cardLast4` | Last 4 digits of card number |
| `cardMasked` | `**** **** **** XXXX` |
| `cardExpiry` | `MM/YY` |
| `createdAt` | ISO timestamp |

**Files:** `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`

---

#### 1.6 Events-First Landing Page & Guest Purchasing ✅

The application previously blocked access behind the login overlay on first load.

- The events listing is now shown immediately on page load — no auth required to browse.
- The auth overlay is hidden by default and opens as a modal when the user chooses to sign in.
- Header shows **Sign In / Register** button when no session is active; replaced by **Welcome + My Account + Sign Out** when logged in.
- Auth overlay has an **× close button** and a **"Browse events without signing in"** link; clicking the backdrop also closes it.
- The purchase form is available to guests. When not logged in, an inline notice offers a quick sign-in/register link above the form, with the option to continue as a guest by filling in name and email manually.
- Sign out now returns to the events page rather than to the login screen.

**Files:** `public/index.html`, `public/app.js`, `public/styles.css`

---

### 🔲 Next Up

#### 1.5 Password Reset (with Ethereal Email)

"Forgot password?" link on the login form opens a reset flow within the auth overlay.

**Flow:**

1. User clicks **Forgot password?** — overlay switches to a reset-request panel (tabs hidden).
2. User enters their **username** and **registered email address**.
3. Server validates the combination. If matched, a time-limited 8-character reset token is generated (expires after 15 minutes).
4. Token is sent as a proper HTML email via **Nodemailer + Ethereal** (fake SMTP capture). The response includes the Ethereal preview URL so the tester can click straight to the captured email.
5. UI shows a confirmation with a **"View your reset email →"** link. A **"I have my code"** button advances to the confirm step.
6. User enters the token and their new password (subject to 1.3 complexity rules).
7. On success, password is updated and the overlay returns to the Sign In form.

**New API endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/reset-password/request` | None | Validates username + email; sends reset email via Ethereal; returns preview URL |
| `POST` | `/api/auth/reset-password/confirm` | None | Validates token + sets new password |

Reset tokens stored in-memory. Tokens expire after 15 minutes (checked on confirm).

#### 1.7 Two-Factor Authentication (Email OTP via Ethereal)

Opt-in per-account 2FA. When enabled, login requires a second step.

**Toggle:** My Account → Security tab → *"Two-factor authentication"* toggle switch.

**Login flow with 2FA enabled:**

1. User enters correct username + password → server generates a 6-digit OTP (10-minute expiry) and sends it via Ethereal.
2. Server responds with `{ requiresTwoFa: true, challengeId, previewUrl }` — no session token yet.
3. UI transitions to a **"Check your email"** panel showing a **"View your verification email →"** link and a code entry field.
4. User enters the OTP → `POST /api/auth/verify-2fa` → session token returned → login completes.

**New API endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/verify-2fa` | None | Validates OTP against challengeId; returns session token |

**User model addition:** `twoFactorEnabled: boolean` (default `false`). Persisted on `PUT /api/account`.

**Email dependency:** `nodemailer` (one npm package). Ethereal test account auto-created at server startup — no sign-up, no `.env` required.

**Files:** `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`, `package.json`

**Files:** `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`

---

## Phase 2 — Purchase History & Ticket Downloads

> Deferred until Phase 1 is complete.

### 2.1 Link Purchases to User Accounts

- Purchase records updated to include `userId` at the time of purchase.
- Purchase form pre-fills name and email from `currentUser`; these are linked to the logged-in account.

**New API endpoint:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/account/purchases` | Required | Returns all purchases for the logged-in user |

**Files:** `server.js`, `public/app.js`

---

### 2.2 Purchase History in "My Account"

A new **My Tickets** tab added to the My Account modal (see 1.4).

Displays a list of past purchases:
- Event name
- Date of event
- Number of tickets
- Total paid
- Booking reference (purchase ID)
- Download button (see 2.3)

---

### 2.3 Downloadable Ticket (PDF with QR Code)

Each purchase in the history list has a **Download Ticket** button.

**Approach — fully client-side, no server dependency:**

- PDF generated in the browser using [`jsPDF`](https://github.com/parallax/jsPDF) (loaded from CDN or bundled).
- QR code generated using [`qrcode`](https://github.com/soldair/node-qrcode) or [`qrcode.js`](https://davidshimjs.github.io/qrcodejs/) — encodes the booking reference number.
- Ticket layout includes:
  - Ticketyboo branding
  - Event name, venue, date, time
  - Booking reference
  - Customer name
  - Number of tickets
  - QR code

**Files:** `public/index.html` (CDN script tags), `public/app.js`, `public/styles.css`

---

## File Summary

| File | Changes |
|---|---|
| `server.js` | Extended user model; `safeUser()`; address fields in register/login/session; `PUT /api/account`; `PUT /api/account/password`; `GET`/`POST` `/api/account/cards`; `DELETE /api/account/cards/:id`; password reset endpoints; `GET /api/account/purchases` |
| `public/index.html` | Extended registration form; My Account modal (Profile, Security, Cards tabs); password reset panel; My Tickets tab |
| `public/app.js` | Password strength indicator; account modal load/save; password/username change; saved cards (list, add, delete); reset flow; purchase history; PDF/QR download |
| `public/styles.css` | Strength indicator styles; account modal styles; reset panel styles; ticket download button styles |

---

## Notes

- The application uses an **in-memory data store** — all data is lost on server restart. This is intentional for a test automation training app and does not need to change.
- All new fields are **optional** at registration. The only required fields are: first name, last name, email address, username, and password. `customerName` is derived server-side as `firstName + ' ' + lastName` by `safeUser()`.
- Password complexity is enforced both client-side (UX) and server-side (validation), consistent with how card validation is handled in the purchase flow.
- The password reset token is displayed on-screen rather than emailed; a prominent notice makes clear this is a training app behaviour.
- **File structure** — `public/app.js` is kept as a single file. It is already sectioned with clear banner comments (`// ─── Auth ─────`, `// ─── Password Complexity ─────`, etc.), which provides adequate organisation at the current scale (~550 lines). A split into ES modules (e.g. `auth.js`, `events.js`, `purchase.js`) would be considered if the file grows beyond ~800–1000 lines or if a build toolchain (e.g. Vite) is introduced.
