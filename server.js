const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// In-memory data store
let events = [
  {
    id: 1,
    type: 'concert',
    name: 'Rock Legends Live',
    artist: 'The Thunder Band',
    venue: 'O2 Arena, London',
    date: '2026-03-15',
    time: '19:00',
    price: 65.00,
    availableTickets: 150,
    description: 'Experience an unforgettable night of rock music with The Thunder Band!'
  },
  {
    id: 2,
    type: 'film',
    name: 'Classic Cinema Night',
    artist: 'The Godfather',
    venue: 'Broadway Cinema, Nottingham',
    date: '2026-03-20',
    time: '20:00',
    price: 12.50,
    availableTickets: 200,
    description: 'Join us for a special screening of this timeless masterpiece.'
  },
  {
    id: 3,
    type: 'comedy',
    name: 'Stand-Up Spectacular',
    artist: 'Sarah Johnson',
    venue: 'The Comedy Store, Manchester',
    date: '2026-03-25',
    time: '21:00',
    price: 28.00,
    availableTickets: 80,
    description: 'Get ready to laugh until your sides hurt with Sarah Johnson!'
  },
  {
    id: 4,
    type: 'concert',
    name: 'Jazz Night',
    artist: 'Blue Note Quintet',
    venue: 'Jam Café, Nottingham',
    date: '2026-04-01',
    time: '20:30',
    price: 42.00,
    availableTickets: 100,
    description: 'An evening of smooth jazz with the acclaimed Blue Note Quintet.'
  },
  {
    id: 5,
    type: 'film',
    name: 'Sci-Fi Marathon',
    artist: 'Blade Runner & The Matrix',
    venue: 'Showcase Cinema, Bristol',
    date: '2026-04-10',
    time: '18:00',
    price: 16.50,
    availableTickets: 120,
    description: 'Double feature of two groundbreaking sci-fi films.'
  },
  {
    id: 6,
    type: 'comedy',
    name: 'Improv Night',
    artist: 'The Comedy Crew',
    venue: 'Komedia, Bath',
    date: '2026-04-15',
    time: '19:30',
    price: 20.00,
    availableTickets: 60,
    description: 'Hilarious improvised comedy based on audience suggestions!'
  }
];

let purchases = [];
let purchaseIdCounter = 1;

// In-memory auth store
let users = [];
let sessions = [];
let userIdCounter = 1;

function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// Returns a user object safe to send to the client (no password)
function safeUser(user) {
  return {
    id:            user.id,
    username:      user.username,
    firstName:     user.firstName,
    middleName:    user.middleName   || '',
    lastName:      user.lastName,
    knownAs:       user.knownAs      || '',
    title:         user.title        || '',
    customerName:  (user.title && user.title !== 'prefer-not' ? user.title + ' ' : '') + user.firstName + (user.middleName ? ' ' + user.middleName : '') + ' ' + user.lastName,
    gender:        user.gender        || '',
    marketingPrefs: user.marketingPrefs || { email: false, sms: false, phone: false, post: false },
    customerEmail: user.customerEmail,
    phone:        user.phone        || '',
    addressLine1: user.addressLine1 || '',
    addressLine2: user.addressLine2 || '',
    postcode:     user.postcode     || '',
    city:         user.city         || '',
    county:       user.county       || '',
    country:      user.country      || ''
  };
}

// ─── Password complexity ────────────────────────────────────────────────────
// Returns a descriptive error string, or null if the password is valid.
function validatePasswordComplexity(password) {
  if (!password || password.length < 8)   return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password))            return 'Password must contain at least one uppercase letter (A–Z).';
  if (!/[a-z]/.test(password))            return 'Password must contain at least one lowercase letter (a–z).';
  if (!/[0-9]/.test(password))            return 'Password must contain at least one number (0–9).';
  if (!/[!@#$%^&*]/.test(password))       return 'Password must contain at least one special character (! @ # $ % ^ & *).';
  return null;
}

// Auth middleware (used by session check endpoint)
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.substring(7);
  const session = sessions.find(s => s.token === token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const user = users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = user;
  next();
}

// API Routes

// POST register
app.post('/api/auth/register', (req, res) => {
  const {
    username, password, title, firstName, middleName, lastName, knownAs, gender, marketingPrefs, customerEmail,
    phone, addressLine1, addressLine2, postcode, city, county, country
  } = req.body;

  if (!username || !password || !firstName || !lastName || !customerEmail) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordError = validatePasswordComplexity(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const user = {
    id: userIdCounter++,
    username,
    password,
    title:        title        || '',
    firstName,
    middleName:   middleName   || '',
    lastName,
    knownAs:      knownAs      || '',
    gender:       gender       || '',
    marketingPrefs: {
      email: !!(marketingPrefs && marketingPrefs.email),
      sms:   !!(marketingPrefs && marketingPrefs.sms),
      phone: !!(marketingPrefs && marketingPrefs.phone),
      post:  !!(marketingPrefs && marketingPrefs.post)
    },
    customerEmail,
    phone:        phone        || '',
    addressLine1: addressLine1 || '',
    addressLine2: addressLine2 || '',
    postcode:     postcode     || '',
    city:         city         || '',
    county:       county       || '',
    country:      country      || ''
  };
  users.push(user);

  const token = generateToken();
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });

  res.status(201).json({
    success: true,
    token,
    user: safeUser(user)
  });
});

// POST login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = generateToken();
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });

  res.json({
    success: true,
    token,
    user: safeUser(user)
  });
});

// POST logout
app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    sessions = sessions.filter(s => s.token !== token);
  }
  res.json({ success: true });
});

// GET session check
app.get('/api/auth/session', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// GET all events
app.get('/api/events', (req, res) => {
  const { type } = req.query;
  let filteredEvents = events;
  
  if (type) {
    filteredEvents = events.filter(event => event.type === type);
  }
  
  res.json(filteredEvents);
});

// GET single event by ID
app.get('/api/events/:id', (req, res) => {
  const eventId = parseInt(req.params.id);
  const event = events.find(e => e.id === eventId);
  
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  res.json(event);
});

// POST purchase tickets
app.post('/api/tickets/purchase', (req, res) => {
  const { eventId, quantity, customerName, customerEmail, cardNumber, cardExpiry, cardCvv, cardholderName } = req.body;
  
  // Validation
  if (!eventId || !quantity || !customerName || !customerEmail) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Validate payment card fields
  if (!cardNumber || !cardExpiry || !cardCvv || !cardholderName) {
    return res.status(400).json({ error: 'Missing payment card information' });
  }
  
  // Basic card validation
  const cardNumberClean = cardNumber.replace(/\s/g, '');
  if (cardNumberClean.length < 13 || cardNumberClean.length > 19) {
    return res.status(400).json({ error: 'Invalid card number' });
  }
  
  if (!/^\d{2}\/\d{2}$/.test(cardExpiry)) {
    return res.status(400).json({ error: 'Invalid expiry date format (MM/YY)' });
  }
  
  // Validate expiry date is not in the past
  const [expMonth, expYear] = cardExpiry.split('/').map(num => parseInt(num, 10));
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear() % 100; // Get last 2 digits
  const currentMonth = currentDate.getMonth() + 1;
  
  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    return res.status(400).json({ error: 'Card has expired' });
  }
  
  if (!/^\d{3,4}$/.test(cardCvv)) {
    return res.status(400).json({ error: 'Invalid CVV' });
  }
  
  const event = events.find(e => e.id === parseInt(eventId));
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  
  if (quantity > event.availableTickets) {
    return res.status(400).json({ error: 'Not enough tickets available' });
  }
  
  if (quantity < 1) {
    return res.status(400).json({ error: 'Quantity must be at least 1' });
  }
  
  // Process purchase
  event.availableTickets -= quantity;
  const totalPrice = event.price * quantity;
  
  // Mask card number for security (show only last 4 digits)
  const maskedCardNumber = '**** **** **** ' + cardNumberClean.slice(-4);
  
  const purchase = {
    id: purchaseIdCounter++,
    eventId: event.id,
    eventName: event.name,
    quantity,
    customerName,
    customerEmail,
    totalPrice,
    cardholderName,
    cardLast4: cardNumberClean.slice(-4),
    cardMasked: maskedCardNumber,
    purchaseDate: new Date().toISOString()
  };
  
  purchases.push(purchase);
  
  res.status(201).json({
    success: true,
    purchase
  });
});

// GET all purchases
app.get('/api/tickets', (req, res) => {
  res.json(purchases);
});

// GET purchase by ID
app.get('/api/tickets/:id', (req, res) => {
  const purchaseId = parseInt(req.params.id);
  const purchase = purchases.find(p => p.id === purchaseId);
  
  if (!purchase) {
    return res.status(404).json({ error: 'Purchase not found' });
  }
  
  res.json(purchase);
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Ticketyboo server running on http://localhost:${PORT}`);
});
