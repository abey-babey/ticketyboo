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

### 🔲 To Do


A **My Account** button added to the header (alongside the existing Sign Out button). Opens a modal with two tabs.

**Header change:**
```
Welcome, [Name]   [My Account]   [Sign Out]
```

**Tab 1 — Profile**

Displays and allows editing of:
- Full Name
- Email Address
- Phone Number
- Address Line 1
- Address Line 2
- Postcode
- City / Town
- County
- Country

Save button calls `PUT /api/account`. Shows inline success/error feedback.

**Tab 2 — Security**

- Change username (validates uniqueness on save)
- Change password:
  - Current Password
  - New Password (with real-time strength indicator — see 1.3)
  - Confirm New Password

Save calls `PUT /api/account/password` (requires current password to be correct).

**New API endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/account` | Required | Returns full profile of logged-in user |
| `PUT` | `/api/account` | Required | Updates profile fields |
| `PUT` | `/api/account/password` | Required | Changes password; requires `currentPassword` in body |

**Files:** `server.js`, `public/index.html`, `public/app.js`, `public/styles.css`

---

#### 1.5 Password Reset

"Forgot password?" link on the login form opens a reset flow within the auth overlay.

**Flow:**

1. User clicks **Forgot password?** — overlay switches to a reset panel.
2. User enters their **username** and **registered email address**.
3. Server validates the combination. If matched, a time-limited reset token is generated (expires after 15 minutes).
4. Because this is a training app with no email service, the token is **displayed on-screen** with a clear notice explaining that in a real application it would be sent by email.
5. User enters the token and their new password (subject to complexity rules from 1.3).
6. On success, password is updated and the user is redirected to the login form.

**New API endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/reset-password/request` | None | Validates username + email; returns reset token (training only) |
| `POST` | `/api/auth/reset-password/confirm` | None | Validates token + sets new password |

Reset tokens stored in-memory alongside sessions. Tokens expire after 15 minutes (checked on confirm).

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
| `server.js` | Extended user model; `safeUser()`; address fields in register/login/session; `PUT /api/account`; `PUT /api/account/password`; password reset endpoints; `GET /api/account/purchases` |
| `public/index.html` | Extended registration form; My Account modal; password reset panel; My Tickets tab |
| `public/app.js` | Password strength indicator; account modal load/save; password change; reset flow; purchase history; PDF/QR download |
| `public/styles.css` | Strength indicator styles; account modal styles; reset panel styles; ticket download button styles |

---

## Notes

- The application uses an **in-memory data store** — all data is lost on server restart. This is intentional for a test automation training app and does not need to change.
- All new fields are **optional** at registration. The only required fields are: first name, last name, email address, username, and password. `customerName` is derived server-side as `firstName + ' ' + lastName` by `safeUser()`.
- Password complexity is enforced both client-side (UX) and server-side (validation), consistent with how card validation is handled in the purchase flow.
- The password reset token is displayed on-screen rather than emailed; a prominent notice makes clear this is a training app behaviour.
- **File structure** — `public/app.js` is kept as a single file. It is already sectioned with clear banner comments (`// ─── Auth ─────`, `// ─── Password Complexity ─────`, etc.), which provides adequate organisation at the current scale (~550 lines). A split into ES modules (e.g. `auth.js`, `events.js`, `purchase.js`) would be considered if the file grows beyond ~800–1000 lines or if a build toolchain (e.g. Vite) is introduced.
