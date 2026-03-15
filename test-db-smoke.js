// Quick smoke test for the SQLite data layer
// Run with: node test-db-smoke.js
// Deletes the test user from the DB after running.

'use strict';

const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token)   headers['Authorization']  = 'Bearer ' + token;

    const req = http.request(
      { hostname: 'localhost', port: 3000, path, method, headers },
      res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(label, condition, detail) {
  if (condition) {
    console.log('  PASS:', label);
  } else {
    console.error('  FAIL:', label, detail !== undefined ? `(got: ${JSON.stringify(detail)})` : '');
    process.exitCode = 1;
  }
}

async function run() {
  console.log('\n=== Ticketyboo DB smoke test ===\n');

  // ── GET /api/events ─────────────────────────────────────────────────────────
  console.log('GET /api/events');
  const eventsRes = await request('GET', '/api/events');
  assert('status 200',      eventsRes.status === 200, eventsRes.status);
  assert('6 events seeded', eventsRes.body.length === 6, eventsRes.body.length);

  // ── POST /api/auth/register ──────────────────────────────────────────────────
  console.log('\nPOST /api/auth/register');
  const regRes = await request('POST', '/api/auth/register', {
    username: 'smoke_test_user', password: 'Smoke1Pass#',
    firstName: 'Smoke', lastName: 'Test', customerEmail: 'smoke@test.example.com'
  });
  assert('status 201',       regRes.status === 201, regRes.status);
  assert('success true',     regRes.body.success === true);
  assert('token present',    typeof regRes.body.token === 'string');
  assert('user.id present',  typeof regRes.body.user.id === 'number', regRes.body.user);
  assert('username correct', regRes.body.user.username === 'smoke_test_user');
  const token = regRes.body.token;
  const userId = regRes.body.user.id;

  // ── GET /api/auth/session ────────────────────────────────────────────────────
  console.log('\nGET /api/auth/session');
  const sessRes = await request('GET', '/api/auth/session', null, token);
  assert('status 200',       sessRes.status === 200, sessRes.status);
  assert('user id matches',  sessRes.body.user.id === userId);

  // ── POST /api/auth/login ─────────────────────────────────────────────────────
  console.log('\nPOST /api/auth/login');
  const loginRes = await request('POST', '/api/auth/login', {
    username: 'smoke_test_user', password: 'Smoke1Pass#'
  });
  assert('status 200',       loginRes.status === 200, loginRes.status);
  assert('success true',     loginRes.body.success === true);
  assert('token present',    typeof loginRes.body.token === 'string');
  const loginToken = loginRes.body.token;

  // ── POST /api/account/cards ──────────────────────────────────────────────────
  console.log('\nPOST /api/account/cards');
  const cardRes = await request('POST', '/api/account/cards', {
    cardNumber: '4111111111111111', cardExpiry: '12/30', cardholderName: 'SMOKE TEST', nickname: 'Visa'
  }, loginToken);
  assert('status 201',         cardRes.status === 201, cardRes.status);
  assert('card id present',    typeof cardRes.body.card.id === 'number');
  assert('cardLast4 correct',  cardRes.body.card.cardLast4 === '1111');
  const cardId = cardRes.body.card.id;

  // ── GET /api/account/cards ───────────────────────────────────────────────────
  console.log('\nGET /api/account/cards');
  const cardsRes = await request('GET', '/api/account/cards', null, loginToken);
  assert('status 200',  cardsRes.status === 200, cardsRes.status);
  assert('1 card',      cardsRes.body.cards.length === 1, cardsRes.body.cards.length);

  // ── POST /api/tickets/purchase ───────────────────────────────────────────────
  console.log('\nPOST /api/tickets/purchase (guest)');
  const purchRes = await request('POST', '/api/tickets/purchase', {
    eventId: 1, quantity: 2, customerName: 'Smoke Test', customerEmail: 'smoke@test.example.com',
    cardNumber: '4111111111111111', cardExpiry: '12/30', cardCvv: '123', cardholderName: 'SMOKE TEST'
  });
  assert('status 201',          purchRes.status === 201, purchRes.status);
  assert('purchase id present', typeof purchRes.body.purchase.id === 'number');
  assert('totalPrice correct',  purchRes.body.purchase.totalPrice === 130.00, purchRes.body.purchase.totalPrice);
  const purchaseId = purchRes.body.purchase.id;

  // ── GET /api/tickets/:id ─────────────────────────────────────────────────────
  console.log('\nGET /api/tickets/:id');
  const tickRes = await request('GET', '/api/tickets/' + purchaseId);
  assert('status 200',     tickRes.status === 200, tickRes.status);
  assert('id matches',     tickRes.body.id === purchaseId);
  assert('eventId is 1',   tickRes.body.eventId === 1);

  // ── DELETE /api/account/cards/:cardId ────────────────────────────────────────
  console.log('\nDELETE /api/account/cards/:cardId');
  const delRes = await request('DELETE', '/api/account/cards/' + cardId, null, loginToken);
  assert('status 200',    delRes.status === 200, delRes.status);
  assert('success true',  delRes.body.success === true);

  // ── POST /api/auth/logout ─────────────────────────────────────────────────────
  console.log('\nPOST /api/auth/logout');
  const logoutRes = await request('POST', '/api/auth/logout', {}, loginToken);
  assert('status 200',    logoutRes.status === 200, logoutRes.status);

  console.log('\n=== Done ===');
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
