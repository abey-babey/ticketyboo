// Quick integration smoke-test for modular refactor features
// Run: node test-integration.js
const app = require('./app');

const srv = app.listen(3002, async () => {
  const base = 'http://localhost:3002';
  const json = { 'Content-Type': 'application/json' };
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const put = (url, body, tok) =>
    fetch(url, {
      method: 'PUT',
      headers: { ...json, Authorization: 'Bearer ' + tok },
      body: JSON.stringify(body),
    });

  let passed = 0;
  let failed = 0;
  const ok  = (label) => { console.log('  PASS', label); passed++; };
  const fail = (label, info) => { console.log('  FAIL', label, info ?? ''); failed++; };
  const check = (label, cond, info) => cond ? ok(label) : fail(label, info);

  try {
    // 1. Traditional password registration
    let r = await post(base + '/api/auth/register', {
      username: 'tester1', password: 'Test@1234',
      firstName: 'A', lastName: 'B', customerEmail: 'a@b.com',
    });
    let d = await r.json();
    check('1) register traditional password', r.status === 201, r.status + ' ' + JSON.stringify(d));
    const tok = d.token;

    // 2. Passphrase registration (>=20 chars, 2+ upper, 1+ digit)
    r = await post(base + '/api/auth/register', {
      username: 'tester2', password: 'BadgerLemonSculpture8',
      firstName: 'A', lastName: 'B', customerEmail: 'c@d.com',
    });
    d = await r.json();
    check('2) register passphrase', r.status === 201, r.status + ' ' + JSON.stringify(d));

    // 3. Reject invalid password (too short, not a passphrase)
    r = await post(base + '/api/auth/register', {
      username: 'tester3', password: 'Short7x',
      firstName: 'A', lastName: 'B', customerEmail: 'e@f.com',
    });
    check('3) reject short/invalid password', r.status === 400, 'got ' + r.status);

    // 4. Reject passphrase that is 20+ chars but only 1 uppercase
    r = await post(base + '/api/auth/register', {
      username: 'tester4', password: 'badgerlemonsculpture8',
      firstName: 'A', lastName: 'B', customerEmail: 'g@h.com',
    });
    check('4) reject passphrase with < 2 uppercase', r.status === 400, 'got ' + r.status);

    // 5. Password reuse — same as current
    r = await put(base + '/api/account/password', {
      currentPassword: 'Test@1234', newPassword: 'Test@1234',
    }, tok);
    d = await r.json();
    check('5) block reuse of current password', r.status === 400, r.status + ' ' + (d.error || ''));

    // 6. Brute-force: 5 failures trigger lockout (5th still returns 401 with warning)
    for (let i = 0; i < 5; i++) {
      r = await post(base + '/api/auth/login', { username: 'tester1', password: 'wrong' });
    }
    // On the 5th failure the account is locked; the 6th attempt returns 429
    r = await post(base + '/api/auth/login', { username: 'tester1', password: 'wrong' });
    check('6) lockout enforced on 6th attempt (429)', r.status === 429, 'got ' + r.status);

    // 7. Correct credentials rejected while locked
    r = await post(base + '/api/auth/login', { username: 'tester1', password: 'Test@1234' });
    check('7) correct credentials blocked during lockout', r.status === 429, 'got ' + r.status);

  } catch (e) {
    console.error('UNCAUGHT ERROR:', e.message);
    failed++;
  } finally {
    srv.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
});
