// ─── In-memory data store ────────────────────────────────────────────────────
// All data lives here and is shared across route modules via require().
// Data is reset on server restart — intentional for a training app.

const store = {
  events: [
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
  ],

  purchases:        [],
  users:            [],
  sessions:         [],
  resetTokens:      [],
  pendingTwoFa:     [],

  purchaseIdCounter: 1,
  userIdCounter:     1,
  cardIdCounter:     1
};

/**
 * Returns a user object safe to send to the client (password stripped).
 * @param {object} user  Raw user record from store.users
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

module.exports = { store, safeUser };
