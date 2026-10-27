import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from 'node:util';
import { prepareGoogleEnvironment } from '../services/googleSetup.js';
const credentials = { web: { client_id: 'example.apps.googleusercontent.com', client_secret: 'dummy-test-only', redirect_uris: ['http://localhost:3000/auth/google/callback'] } };
test('OAuth setup imports configuration without changing database values', () => {
  const source = '# Keep this comment\nDB_NAME=ExistingDatabase\nDB_PASSWORD="dummy#local"\nSESSION_SECRET=replace-with-at-least-32-random-characters\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nAPP_URL=http://localhost:3000\n';
  const result = prepareGoogleEnvironment(credentials, source);
  const env = parseEnv(result.content);
  assert.equal(env.DB_NAME, 'ExistingDatabase');
  assert.equal(env.DB_PASSWORD, 'dummy#local');
  assert.equal(env.GOOGLE_CLIENT_ID, credentials.web.client_id);
  assert.equal(env.GOOGLE_CLIENT_SECRET, credentials.web.client_secret);
  assert.equal(env.GOOGLE_REDIRECT_URI, 'http://localhost:3000/auth/google/callback');
  assert.match(env.SESSION_SECRET, /^[a-f0-9]{64}$/);
  assert.ok(result.content.includes('# Keep this comment'));
  assert.equal(prepareGoogleEnvironment(credentials, result.content).content, result.content);
});
test('OAuth setup rejects unsupported clients, credentials and callbacks', () => {
  assert.throws(() => prepareGoogleEnvironment({ installed: credentials.web }), /Web application/);
  assert.throws(() => prepareGoogleEnvironment({ web: { ...credentials.web, client_secret: 'bad\nKEY=value' } }), /Web application/);
  assert.throws(() => prepareGoogleEnvironment(credentials, 'APP_URL=http://localhost:4000'), /authorised redirect/);
  assert.throws(() => prepareGoogleEnvironment(credentials, 'APP_URL=not-a-url'), /valid/);
  assert.throws(() => prepareGoogleEnvironment(credentials, 'APP_URL=http://localhost:3000/path'), /origin/);
});
test('OAuth setup preserves a configured session secret', () => {
  const secret = 'dummy-existing-session-value';
  const result = prepareGoogleEnvironment(credentials, `SESSION_SECRET=${secret}\n`);
  assert.equal(parseEnv(result.content).SESSION_SECRET, secret);
});
