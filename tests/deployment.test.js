import test from 'node:test';
import assert from 'node:assert/strict';
import { publicUrl, mysqlTransport } from '../config/deployment.js';
import flash from '../middleware/flash.js';
test('production derives HTTPS origin from Render with an optional custom domain override', () => {
  assert.equal(publicUrl({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://example-test.onrender.com/' }), 'https://example-test.onrender.com');
  assert.equal(publicUrl({ NODE_ENV: 'production', APP_URL: 'https://example.org', RENDER_EXTERNAL_URL: 'https://example-test.onrender.com' }), 'https://example.org');
  assert.throws(() => publicUrl({ NODE_ENV: 'production' }), /Production/);
  assert.throws(() => publicUrl({ APP_URL: 'https://example.org/path' }), /origin/);
  assert.equal(publicUrl({}), 'http://localhost:3000');
});
test('cloud database TLS verifies certificates and supports secret CA files', () => {
  assert.deepEqual(mysqlTransport({}), {});
  assert.deepEqual(mysqlTransport({ DB_SSL: 'true' }), { ssl: { rejectUnauthorized: true } });
  assert.equal(mysqlTransport({ DB_SSL: 'true', DB_SSL_CA: 'dummy\\nca' }).ssl.ca, 'dummy\nca');
  assert.equal(mysqlTransport({ DB_SSL: 'true', DB_SSL_CA_FILE: '/secret/ca.pem' }, path => { assert.equal(path, '/secret/ca.pem'); return 'dummy ca'; }).ssl.ca, 'dummy ca');
  assert.throws(() => mysqlTransport({ DB_SSL_CA: 'dummy ca' }), /DB_SSL/);
});
test('flash messages survive redirects, consume once and support arrays without deprecated APIs', () => {
  const req = { session: {} }; let called = false;
  flash()(req, {}, () => { called = true; }); assert.equal(called, true);
  req.flash('error_msg', ['one', 'two']);
  req.flash('success_msg', 'Saved %s', 'profile');
  assert.deepEqual(req.flash('error_msg'), ['one', 'two']);
  assert.deepEqual(req.flash('error_msg'), []);
  assert.deepEqual(req.flash(), { success_msg: ['Saved profile'] });
  assert.deepEqual(req.flash(), {});
  assert.throws(() => req.flash('bad.type', 'x'));
});
