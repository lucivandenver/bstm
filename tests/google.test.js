import test from 'node:test';
import assert from 'node:assert/strict';
import { browser } from './httpHelpers.js';
process.env.NODE_ENV = 'test'; process.env.TEST_DB_STORAGE = ':memory:';
process.env.GOOGLE_CLIENT_ID = 'test-client-id'; process.env.GOOGLE_CLIENT_SECRET = 'dummy-client-secret';
const { OAuth2Client } = await import('google-auth-library');
const { sequelize, User } = await import('../models/learningModels.js');
const { seedAdministration, bootstrapAdmin, ownerEmail } = await import('../services/accounts.js');
const { startServer, closeResources } = await import('../index.js');
let payload, calls = 0;
const oldGet = OAuth2Client.prototype.getToken, oldVerify = OAuth2Client.prototype.verifyIdToken;
OAuth2Client.prototype.getToken = async () => { calls++; return { tokens: { id_token: 'dummy' } }; };
OAuth2Client.prototype.verifyIdToken = async () => ({ getPayload: () => payload });
await test('Google login never registers users; registration completion and owner login are verified', async () => {
  await sequelize.sync({ force: true }); await seedAdministration(); await bootstrapAdmin();
  const server = await startServer(0); const base = `http://127.0.0.1:${server.address().port}`; const b = browser(base);
  async function start(intent = 'login', role = 'student') {
    const r = await b.get(`/auth/google?intent=${intent}&role=${role}`); const url = new URL(r.location);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    return { state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce') };
  }
  async function callback(flow, overrides = {}) {
    payload = { sub: 'google-new', email: 'new@gmail.com', name: 'Google Student', email_verified: true, nonce: flow.nonce, ...overrides };
    return b.get(`/auth/google/callback?state=${flow.state}&code=dummy`);
  }
  try {
    let flow = await start(); let r = await b.get('/auth/google/callback?state=bad&code=dummy'); assert.equal(r.location, '/?auth=login'); assert.equal(calls, 0);
    flow = await start(); await callback(flow, { nonce: 'wrong' }); assert.equal(await User.count({ where: { email: 'new@gmail.com' } }), 0);
    flow = await start(); await callback(flow, { email_verified: false }); assert.equal(await User.count({ where: { email: 'new@gmail.com' } }), 0);
    flow = await start(); r = await callback(flow); assert.equal(r.location, '/?auth=login');
    r = await b.get('/?auth=login'); assert.ok(r.html.includes('This account is not yet registered. Please register first.'));
    assert.equal(await User.count({ where: { email: 'new@gmail.com' } }), 0);
    flow = await start('register'); r = await callback(flow); assert.equal(r.location, '/register?role=student');
    assert.equal(await User.count({ where: { email: 'new@gmail.com' } }), 0, 'Google callback alone must not create a user');
    r = await b.get('/register'); assert.ok(r.html.includes('value="Google Student"')); assert.ok(r.html.includes('name="identityId"'));
    r = await b.post('/register', { account_type: 'student', name: 'Google Student' }); assert.equal(r.location, '/register?role=student');
    r = await b.post('/register', { account_type: 'admin', name: 'Google Student', identityId: '2026-G01', section: 'BSTM 4-1', gender: 'Female' }); assert.equal(r.status, 302);
    assert.equal(await User.count({ where: { email: 'new@gmail.com' } }), 0);
    await b.get('/register');
    r = await b.post('/register', { account_type: 'student', name: 'Google Student', identityId: '2026-G01', section: 'BSTM 4-1', gender: 'Female', email: 'tampered@example.com', role: 'admin' });
    assert.equal(r.location, '/student/profile');
    const student = await User.findOne({ where: { email: 'new@gmail.com' } }); assert.equal(student.role, 'student'); assert.equal(student.password, null); assert.equal(student.gender, 'Female'); assert.equal(student.studentId, '2026-G01'); assert.equal(student.googleId, 'google-new');
    await b.get('/student/profile'); await b.post('/logout');
    flow = await start(); r = await callback(flow); assert.equal(r.location, '/dashboard');
    await b.get('/student/profile'); await b.post('/logout');
    flow = await start('register', 'faculty'); await callback(flow, { sub: 'google-faculty', email: 'faculty@gmail.com', name: 'Google Faculty' });
    r = await b.get('/register'); assert.ok(r.html.includes('Faculty ID'));
    await b.post('/register', { account_type: 'faculty', name: 'Google Faculty', identityId: 'FAC-001', section: 'injected', gender: 'Male' });
    const faculty = await User.findOne({ where: { email: 'faculty@gmail.com' } }); assert.equal(faculty.facultyId, 'FAC-001'); assert.equal(faculty.section, null); assert.equal(faculty.approvalStatus, 'pending');
    flow = await start(); r = await callback(flow, { sub: 'google-faculty', email: 'faculty@gmail.com' }); assert.equal(r.location, '/?auth=login');
    r = await b.get('/faculty'); assert.equal(r.location, '/login');
    flow = await start(); r = await callback(flow, { sub: 'google-owner', email: ownerEmail(), name: 'Owner' }); assert.equal(r.location, '/dashboard');
    r = await b.get('/dashboard'); assert.equal(r.location, '/admin'); r = await b.get('/admin'); assert.equal(r.status, 200);
    const owner = await User.findOne({ where: { email: ownerEmail() } }); assert.equal(owner.role, 'admin'); assert.equal(owner.googleId, 'google-owner');
  } finally { OAuth2Client.prototype.getToken = oldGet; OAuth2Client.prototype.verifyIdToken = oldVerify; await new Promise(resolve => server.close(resolve)); await closeResources(); }
});
