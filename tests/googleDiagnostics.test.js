import test from 'node:test';
import assert from 'node:assert/strict';
import { googleDiagnostic } from '../services/googleDiagnostics.js';
test('Google diagnostics classify credentials, schema, network and session errors', () => {
  assert.equal(googleDiagnostic({ response: { data: { error: 'invalid_client' } } }, 'exchange-token').code, 'GOOGLE_CLIENT_CONFIGURATION');
  assert.equal(googleDiagnostic({ response: { data: { error: 'invalid_grant' } } }, 'exchange-token').code, 'GOOGLE_CODE_REJECTED');
  assert.equal(googleDiagnostic({ original: { code: 'ER_BAD_FIELD_ERROR' } }, 'database').code, 'DATABASE_SCHEMA');
  assert.equal(googleDiagnostic({ original: { code: 'ER_BAD_NULL_ERROR' } }, 'database').code, 'DATABASE_SCHEMA');
  assert.equal(googleDiagnostic({ code: 'ENOTFOUND' }, 'verify-token').code, 'GOOGLE_NETWORK');
  assert.equal(googleDiagnostic({}, 'session').code, 'ACCOUNT_SESSION');
  assert.equal(googleDiagnostic({ signinCode: 'ACCOUNT_DISABLED' }, 'database').code, 'ACCOUNT_DISABLED');
});
test('diagnostics never echo arbitrary exception content or provider responses', () => {
  const error = { message: 'private-placeholder', stack: 'private-placeholder', response: { data: { error: 'private-placeholder', error_description: 'private-placeholder', id_token: 'private-placeholder' } }, config: { client_secret: 'private-placeholder' } };
  for (const stage of ['exchange-token', 'verify-token', 'check-identity', 'database', 'session']) {
    assert.ok(!JSON.stringify(googleDiagnostic(error, stage)).includes('private-placeholder'));
  }
});
