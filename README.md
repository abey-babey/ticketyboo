# Ticketyboo 🎫

A Node.js application for browsing and purchasing event tickets. Designed as a realistic training target for Playwright test automation — it surfaces a broad range of testable flows including authentication, account management, 2FA, payment cards, ticket purchasing, PDF downloads, and a RESTful API.

> **Training application notice** — data is stored in memory and resets on each server restart. This is intentional. Ethereal (fake SMTP) is used for all outbound email; no real emails are sent.

---

## Features

### Browsing & purchasing

- Browse events without signing in — no login wall on the homepage
- Filter events by type (concert, film, comedy, festival, and more)
- Purchase tickets as a guest (name + email at checkout) or as a logged-in customer
- Downloadable PDF ticket with QR code for each purchase

### Authentication

- Register with a full customer profile (name, address, marketing preferences)
- Login with username and password
- Two-factor authentication (email OTP via Ethereal) — opt-in per account
- Password reset flow (token sent via Ethereal, preview URL shown in the UI)
- Rate limiting: 5 failed login attempts triggers a 15-minute lockout

### Password security

- Complexity rules enforced both client-side (live checklist) and server-side:
  - Minimum 8 characters
  - At least one uppercase letter, one lowercase letter, one digit, one special character (`! @ # $ % ^ & *`)

### My Account

- **Profile tab** — view and edit name, address, email, phone
- **Security tab** — change username, change password, toggle 2FA
- **Payment Cards tab** — save cards (last 4 digits and expiry only; full number never stored), remove cards
- **Purchase History tab** — view all past purchases, download PDF ticket for each

---

## Getting Started

### Prerequisites

- Node.js **v18 or higher** (LTS recommended)
- npm

**Key dependencies** (installed automatically via `npm install`):

| Package | Purpose |
| --- | --- |
| `express` | HTTP server and routing |
| `bcryptjs` | Password hashing (cost factor 10) |
| `nodemailer` | Email delivery via Ethereal (fake SMTP) |
| `pdfkit` | PDF ticket generation |
| `qrcode` | QR code embedded in PDF tickets |

### Installation

```bash
git clone https://github.com/danbilling-pbs/ticketyboo.git
cd ticketyboo
npm install
```

### Running the app

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

On startup the server prints:

```text
Ticketyboo running on http://localhost:3000
Ethereal test account ready — outbound emails captured at https://ethereal.email
```

The Ethereal preview URL for any sent email (password reset, OTP code) is also returned in the relevant API response body, so you can click straight to the captured message without leaving the app.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port the server listens on |

---

## Architecture overview

```text
ticketyboo/
├── server.js              Entry point — mounts middleware and routes
├── app.js                 Express app factory (used by tests)
├── lib/
│   ├── store.js           In-memory data store (users, sessions, events, purchases)
│   ├── tokenUtils.js      Session token and OTP helpers
│   ├── passwordValidator.js  Complexity rule functions
│   └── emailService.js    Nodemailer + Ethereal transport
├── middleware/
│   ├── requireAuth.js     Checks Bearer session token; attaches req.user
│   └── rateLimiter.js     Per-IP failed-login rate limiter
├── routes/
│   ├── auth.js            /api/auth/*
│   ├── account.js         /api/account/*
│   ├── events.js          /api/events/*
│   └── tickets.js         /api/tickets/*
└── public/
    ├── index.html         Single-page application shell
    ├── app.js             All client-side JavaScript
    └── styles.css         All styles
```

---

## Roles

| Role | How to obtain | Capabilities |
| --- | --- | --- |
| **Guest** | No action required | Browse events, purchase tickets (name + email at checkout) |
| **Customer** | Register an account | Everything a guest can do, plus: My Account, saved cards, purchase history, PDF downloads, 2FA |
| **Administrator** | Seeded at first boot (credentials printed to console) | *(Planned — Phase C)* Access to admin panel, customer management, logs |

---

## API Reference

A full **OpenAPI 3.0.3** specification is maintained at [`docs/openapi.yaml`](docs/openapi.yaml). It covers every endpoint with complete request/response schemas, error examples, and security definitions.

**Loading the spec:**

- **Swagger UI** — drag-and-drop `docs/openapi.yaml` into [editor.swagger.io](https://editor.swagger.io)
- **Postman** — *Import → File → docs/openapi.yaml* to generate a ready-to-run collection
- **VS Code** — install the [Swagger Viewer](https://marketplace.visualstudio.com/items?itemName=Arjun.swagger-viewer) extension for inline rendering

---

## API Endpoints

All API responses use JSON. Authenticated endpoints require an `Authorization: Bearer <token>` header. The session token is returned by the login and registration responses.

### Authentication — `/api/auth`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | None | Register a new customer account |
| `POST` | `/api/auth/login` | None | Login; returns session token (or 2FA challenge) |
| `POST` | `/api/auth/logout` | Required | Invalidate the current session token |
| `GET` | `/api/auth/session` | Required | Return the current user's profile |
| `POST` | `/api/auth/verify-2fa` | None | Submit OTP to complete a 2FA login |
| `POST` | `/api/auth/reset-password/request` | None | Send password reset token via Ethereal |
| `POST` | `/api/auth/reset-password/confirm` | None | Set a new password using the reset token |

### Account — `/api/account`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/account` | Required | Get the current user's full profile |
| `PUT` | `/api/account` | Required | Update profile fields (including username) |
| `PUT` | `/api/account/password` | Required | Change password (requires current password) |
| `GET` | `/api/account/cards` | Required | List saved payment cards (masked) |
| `POST` | `/api/account/cards` | Required | Save a new card (last 4 digits stored only) |
| `DELETE` | `/api/account/cards/:cardId` | Required | Remove a saved card |
| `GET` | `/api/account/purchases` | Required | List purchases for the logged-in user |

### Events — `/api/events`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/events` | None | List all events (filter: `?type=concert`) |
| `GET` | `/api/events/:id` | None | Get a single event |

### Tickets — `/api/tickets`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/tickets/purchase` | None | Purchase tickets (guest or authenticated) |
| `GET` | `/api/tickets` | None | List all purchases |
| `GET` | `/api/tickets/:id` | None | Get a single purchase |
| `GET` | `/api/tickets/:id/download` | None | Download PDF ticket |

### Example requests

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Jane","lastName":"Smith","customerEmail":"jane@example.com","username":"jsmith","password":"Passw0rd!"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jsmith","password":"Passw0rd!"}'

# Get events (no auth)
curl http://localhost:3000/api/events

# Purchase as guest
curl -X POST http://localhost:3000/api/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{"eventId":1,"quantity":2,"customerName":"Jane Smith","customerEmail":"jane@example.com"}'

# Get account (authenticated)
curl http://localhost:3000/api/account \
  -H "Authorization: Bearer <token>"
```

---

## Playwright Testing Guide

### Why Ticketyboo?

The application is designed to provide a wide surface of realistic, testable scenarios:

| Scenario type | Examples |
| --- | --- |
| **Authentication flows** | Register, login, logout, wrong password, rate-limit lockout, 2FA |
| **Form validation** | Password complexity, required fields, card expiry validation |
| **API testing** | Direct `request` calls to all endpoints; intercept with `page.route()` |
| **State management** | Logged-in vs guest state, session persistence across page loads |
| **File downloads** | PDF ticket download, verify content type and response |
| **Email flows** | Password reset token, 2FA OTP — captured at Ethereal preview URL in API response |
| **Modal / overlay UI** | Auth overlay, My Account modal, purchase form |

### Sample test scenarios

```javascript
// Register a new user
await page.goto('http://localhost:3000');
await page.getByRole('button', { name: 'Sign In / Register' }).click();
await page.getByRole('tab', { name: 'Register' }).click();
// ... fill fields ...

// Login and verify session
const response = await request.post('/api/auth/login', {
  data: { username: 'jsmith', password: 'Passw0rd!' }
});
expect(response.ok()).toBeTruthy();
const { token } = await response.json();

// Purchase ticket via API
const purchase = await request.post('/api/tickets/purchase', {
  data: { eventId: 1, quantity: 2, customerName: 'Jane Smith', customerEmail: 'jane@example.com' }
});
expect(purchase.status()).toBe(201);

// Download PDF and check content-type
const pdf = await request.get(`/api/tickets/${purchaseId}/download`);
expect(pdf.headers()['content-type']).toContain('application/pdf');

// Test rate limiting — 6th failed login should return 429
for (let i = 0; i < 6; i++) {
  await request.post('/api/auth/login', { data: { username: 'jsmith', password: 'wrong' } });
}
const locked = await request.post('/api/auth/login', { data: { username: 'jsmith', password: 'wrong' } });
expect(locked.status()).toBe(429);
```

---

## Technology Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js v18+ |
| HTTP server | Express 4.x |
| Password hashing | bcryptjs (cost 10) |
| Email | Nodemailer + Ethereal (fake SMTP) |
| PDF generation | pdfkit + qrcode |
| Data storage | In-memory (intentional — resets on restart) |
| Front end | Vanilla JavaScript, HTML5, CSS3 (no build toolchain) |

---

## Contributing

Branches follow the `copilot/` naming convention (e.g. `copilot/phase-b-sqlite`). See [`docs/roadmap-2026.md`](docs/roadmap-2026.md) for the full development plan.

---

## License

MIT — see [LICENSE](LICENSE) for details.
