// Only fixed codes and messages may reach logs. Never forward provider descriptions,
// request configs, token responses, SQL, identity payloads or exception messages.
export function googleDiagnostic(error, stage) {
  const provider = error?.response?.data?.error;
  const dbCode = error?.original?.code || error?.parent?.code;
  const connectionCode = error?.code || error?.cause?.code;
  if (['invalid_client', 'unauthorized_client'].includes(provider)) {
    return { code: 'GOOGLE_CLIENT_CONFIGURATION', message: 'Google rejected the app credentials. Re-import the correct OAuth Web client JSON and restart the server.' };
  }
  if (provider === 'redirect_uri_mismatch') {
    return { code: 'GOOGLE_CALLBACK_CONFIGURATION', message: 'The Google callback URL does not match the OAuth client configuration.' };
  }
  if (provider === 'invalid_grant') {
    return { code: 'GOOGLE_CODE_REJECTED', message: 'Google rejected this sign-in code. Start a new sign-in attempt from the login page.' };
  }
  if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_NULL_ERROR', 'WARN_DATA_TRUNCATED', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'].includes(dbCode)) {
    return { code: 'DATABASE_SCHEMA', message: 'The account could not be saved because the database schema is incompatible. Back up the database and run npm run migrate.' };
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(connectionCode)) {
    return { code: 'GOOGLE_NETWORK', message: 'The server could not securely reach Google. Check the internet connection, system date and certificate configuration.' };
  }
  if (error?.signinCode === 'ACCOUNT_DISABLED') return { code: 'ACCOUNT_DISABLED', message: 'This account is inactive. Contact the system administrator.' };
  if (error?.signinCode === 'ACCOUNT_LINK') return { code: 'ACCOUNT_LINK', message: 'Sign in again and choose the Google account with the same email as your existing account.' };
  if (stage === 'verify-token' || stage === 'check-identity') return { code: 'GOOGLE_IDENTITY_VERIFICATION', message: 'Google identity verification failed. Start a fresh sign-in and check the server clock and configuration.' };
  if (stage === 'database') return { code: 'ACCOUNT_DATABASE', message: 'The student account could not be read or saved. Check the database migration and connection.' };
  if (stage === 'session') return { code: 'ACCOUNT_SESSION', message: 'The sign-in session could not be saved. Check the database connection and try again.' };
  return { code: 'GOOGLE_TOKEN_EXCHANGE', message: 'Google sign-in could not be completed during token exchange. Check the app configuration and connection.' };
}
