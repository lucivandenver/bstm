import fs from 'node:fs';
export function publicUrl(env = process.env) {
  const value = (env.APP_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, '');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('APP_URL must be the public site origin.');
  if (env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Production requires a public HTTPS APP_URL or RENDER_EXTERNAL_URL.');
  return url.origin;
}
export function mysqlTransport(env = process.env, read = file => fs.readFileSync(file, 'utf8')) {
  if (['localhost', '127.0.0.1'].includes(env.DB_HOST?.toLowerCase())) return {};
  const enabled = env.DB_SSL === 'true';
  const inline = env.DB_SSL_CA;
  const filename = env.DB_SSL_CA_FILE;
  if ((inline || filename) && !enabled) throw new Error('Set DB_SSL=true when providing a database CA certificate.');
  if (!enabled) return {};
  const ca = inline ? inline.replace(/\\n/g, '\n') : filename ? read(filename) : undefined;
  return { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
}

export function mysqlConnection(env = process.env) {
  return {
    database: env.DB_NAME || 'BSTM',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    ...mysqlTransport({ ...env, DB_HOST: env.DB_HOST || 'localhost' })
  };
}
