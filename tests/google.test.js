import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test'; process.env.TEST_DB_STORAGE = ':memory:';
process.env.GOOGLE_CLIENT_ID = 'test-client-id'; process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
const { OAuth2Client } = await import('google-auth-library');
const { sequelize, User } = await import('../models/learningModels.js');
const { startServer, closeResources } = await import('../index.js');
let payload, exchangeError, exchanges = 0;
const originalGet = OAuth2Client.prototype.getToken;
const originalVerify = OAuth2Client.prototype.verifyIdToken;
OAuth2Client.prototype.getToken = async function () { exchanges++; if (exchangeError) throw exchangeError; return { tokens: { id_token: 'mock-id-token' } }; };
OAuth2Client.prototype.verifyIdToken = async function () { return { getPayload: () => payload }; };
await test('Google signup verifies state, nonce and email; linking requires an existing login', async () => {
  await sequelize.sync({ force: true });
  const server = await startServer(0); const base = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '', csrf: '' };
  async function request(path, options = {}) {
    const r = await fetch(base + path, { ...options, headers: { ...(options.headers || {}), cookie: jar.cookie }, redirect: 'manual' });
    if (r.headers.get('set-cookie')) jar.cookie = r.headers.get('set-cookie').split(';')[0];
    const html = await r.text(); const match = html.match(/name="_csrf" value="([^"]+)"/); if (match) jar.csrf = match[1];
    return { r, html };
  }
  async function start() {
    const result = await request('/auth/google');
    const url = new URL(result.r.headers.get('location'));
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return { state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
  }
  async function callback(flow, custom = {}) {
    payload = { sub: 'google-sub-one', email: 'google@example.com', email_verified: true, name: 'Google Student', nonce: flow.nonce, ...custom };
    return request(`/auth/google/callback?state=${flow.state}&code=test-code`);
  }
  try {
    let flow = await start();
    let r = await request('/auth/google/callback?state=invalid&code=test-code');
    assert.equal(r.r.headers.get('location'), '/login'); assert.equal(exchanges, 0);
    flow = await start();
    const originalLog = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    exchangeError = { response: { data: { error: 'invalid_client', error_description: 'private-placeholder' } }, config: { client_secret: 'private-placeholder' } };
    try { await callback(flow); } finally { exchangeError = undefined; console.error = originalLog; }
    const failed = await request('/login');
    assert.ok(failed.html.includes('GOOGLE_CLIENT_CONFIGURATION'));
    assert.ok(logs.join(' ').includes('GOOGLE_CLIENT_CONFIGURATION'));
    assert.ok(!logs.join(' ').includes('private-placeholder'));
    flow = await start(); await callback(flow, { nonce: 'wrong' }); assert.equal(await User.count(), 0);
    flow = await start(); await callback(flow, { email_verified: false }); assert.equal(await User.count(), 0);
    flow = await start(); r = await callback(flow);
    assert.equal(r.r.headers.get('location'), '/dashboard');
    const google = await User.findOne({ where: { googleId: 'google-sub-one' } });
    assert.equal(google.role, 'student'); assert.equal(google.password, null); assert.equal(google.emailVerified, true);
    await request('/student/profile');
    await request('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf }) });
    flow = await start(); await callback(flow); assert.equal(await User.count(), 1, 'same Google sub must reuse the account');
    await request('/student/profile'); await request('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf }) });
    await request('/register');
    await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf, name: 'Password User', email: 'password@example.com', student_id: '2026-PASS', section: '4-1', password: 'password12345', confirm_password: 'password12345' }) });
    await request('/student/profile'); await request('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf }) });
    flow = await start(); r = await callback(flow, { sub: 'password-google', email: 'password@example.com' });
    assert.equal(r.r.headers.get('location'), '/login');
    assert.equal((await User.findOne({ where: { email: 'password@example.com' } })).googleId, null, 'never silently link a password account');
    await request('/login');
    await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf, email: 'password@example.com', password: 'password12345' }) });
    await request('/student/profile');
    r = await request('/student/connect-google', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: jar.csrf }) });
    const url = new URL(r.r.headers.get('location'));
    await callback({ state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') }, { sub: 'password-google', email: 'password@example.com' });
    assert.equal((await User.findOne({ where: { email: 'password@example.com' } })).googleId, 'password-google');
  } finally {
    OAuth2Client.prototype.getToken = originalGet; OAuth2Client.prototype.verifyIdToken = originalVerify;
    await new Promise(resolve => server.close(resolve)); await closeResources();
  }
});
