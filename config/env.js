import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
export const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('Set SESSION_SECRET to at least 32 random characters in production.');
}
export const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
export const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
