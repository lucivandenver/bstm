import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';

export function prepareGoogleEnvironment(credentials, source = '') {
  const web = credentials?.web;
  if (!web || typeof web.client_id !== 'string' || !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(web.client_id) ||
      typeof web.client_secret !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(web.client_secret)) {
    throw new Error('Choose a valid Google OAuth Web application client JSON. Credential values will not be printed.');
  }
  const current = parseEnv(source);
  const appUrl = (current.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  let url;
  try { url = new URL(appUrl); } catch { throw new Error('APP_URL must be a valid http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('APP_URL must contain only the site origin, for example http://localhost:3000.');
  }
  const redirect = `${url.origin}/auth/google/callback`;
  if (!Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(redirect)) {
    throw new Error(`Add this exact authorised redirect URI to the Google OAuth client and download its JSON again: ${redirect}`);
  }
  const values = {
    APP_URL: url.origin,
    GOOGLE_CLIENT_ID: web.client_id,
    GOOGLE_CLIENT_SECRET: web.client_secret,
    GOOGLE_REDIRECT_URI: redirect
  };
  if (!current.SESSION_SECRET || current.SESSION_SECRET.startsWith('replace-with-')) values.SESSION_SECRET = randomBytes(32).toString('hex');
  // Replace active assignments only; preserve DB settings, comments and unrelated keys.
  const remaining = { ...values };
  const lines = source.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !(match[1] in values)) return line;
    const key = match[1];
    delete remaining[key];
    return `${key}=${JSON.stringify(values[key])}`;
  });
  for (const [key, value] of Object.entries(remaining)) lines.push(`${key}=${JSON.stringify(value)}`);
  return { content: lines.join('\n').replace(/\n*$/, '\n'), appUrl: url.origin, redirect };
}
