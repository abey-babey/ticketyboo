# Ticketyboo 🎫

A NodeJS application for purchasing event tickets (concerts, films, and comedy shows). This application is designed to aid with Playwright test automation learning.

## Features

- Browse events by category (concerts, films, comedy shows)
- View detailed event information
- Purchase tickets with a simple form
- Real-time ticket availability updates
- Purchase confirmation with details
- RESTful API endpoints for automation testing

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:

```bash
git clone https://github.com/danbilling-pbs/ticketyboo.git
cd ticketyboo
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open your browser and navigate to:

```text
http://localhost:3000
```

## API Endpoints

The application provides the following REST API endpoints for testing:

### Events

- **GET** `/api/events` - Get all events
  - Query params: `?type=concert|film|comedy` (optional filter)
- **GET** `/api/events/:id` - Get a specific event by ID

### Tickets

- **POST** `/api/tickets/purchase` - Purchase tickets
  - Body: `{ eventId, quantity, customerName, customerEmail }`
- **GET** `/api/tickets` - Get all purchases
- **GET** `/api/tickets/:id` - Get a specific purchase by ID

### Example API Request

```bash
# Get all events
curl http://localhost:3000/api/events

# Purchase tickets
curl -X POST http://localhost:3000/api/tickets/purchase \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 1,
    "quantity": 2,
    "customerName": "John Doe",
    "customerEmail": "john@example.com"
  }'
```

## Usage for Playwright Testing

This application is perfect for learning and practicing Playwright automation:

1. **Element Selection**: Practice locating elements by text, role, and test IDs
2. **Form Interaction**: Test form filling and validation
3. **API Testing**: Intercept and mock API calls
4. **Visual Testing**: Verify UI components and layouts
5. **E2E Flows**: Test complete user journeys from browsing to purchase

### Sample Test Scenarios

- Filter events by category
- View event details
- Fill purchase form with valid/invalid data
- Complete a ticket purchase
- Verify purchase confirmation
- Test API endpoints directly

## Technology Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Data Storage**: In-memory (resets on server restart)

## License

MIT License - see LICENSE file for details
