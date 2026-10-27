/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    
import './config/env.js';
import express from 'express';
import path from 'node:path';
import session from 'express-session';
import flash from './middleware/flash.js';
import connectSessionSequelize from 'connect-session-sequelize';
import fs from 'node:fs';
import hbs from 'hbs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import router from './routes/index.js';
import { sequelize } from './models/learningModels.js';
import { csrf } from './middleware/security.js';
import { production, sessionSecret, googleReady, appUrl } from './config/env.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.get('/healthz', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { await sequelize.authenticate(); res.json({ status: 'ok' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});
const SequelizeStore = connectSessionSequelize(session.Store);
const sessionStore = new SequelizeStore({ db: sequelize, tableName: 'Sessions', expiration: 8 * 60 * 60 * 1000 });
app.use(session({ name: 'careerbridge.sid', secret: sessionSecret, store: sessionStore,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(flash());
app.use(csrf);
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.googleReady = googleReady();
  res.locals.devReload = !production && process.env.NODE_ENV !== 'test';
  next();
});
app.engine('xian', hbs.__express);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'xian');
// Register synchronously before listening, including shared student layout partials.
for (const file of fs.readdirSync(path.join(__dirname, 'views/partials'))) {
  if (file.endsWith('.xian')) hbs.registerPartial(file.replace('.xian', ''), fs.readFileSync(path.join(__dirname, 'views/partials', file), 'utf8'));
}
hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('selected', (a, b) => a === b ? 'selected' : '');
// Developer-only file reload. Student progress updates use persisted application endpoints.
const clients = new Set();
const watchers = [];
if (!production && process.env.NODE_ENV !== 'test') {
  app.get('/api/live-reload', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders(); clients.add(res); res.write('data: connected\n\n');
    req.on('close', () => clients.delete(res));
  });
  let debounce;
  for (const dir of ['views', 'public']) {
    try {
      const watcher = fs.watch(path.join(__dirname, dir), { recursive: true }, () => {
        clearTimeout(debounce); debounce = setTimeout(() => { for (const client of clients) client.write('data: reload\n\n'); }, 100);
      });
      watchers.push(watcher);
    } catch (error) { console.log('Live reload:', error.message); }
  }
}
app.use('/', router);
app.use((req, res) => res.status(404).render('student/message', { title: 'Page not found', message: 'This page does not exist.', currentUser: null }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const expected = error.status && error.status < 500;
  if (!expected) console.error('Request failed:', error.name); // Do not log tokens, personal data or DB SQL.
  res.status(expected ? error.status : 500).render('student/message', { title: 'Unable to continue',
    message: expected ? error.message : 'Something went wrong. Please retry. Check database setup if this persists.' });
});
export default app;
export const startServer = async (port = PORT) => {
  await sequelize.authenticate();
  await sessionStore.sync();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => { console.log(`CareerBridge is running. Open ${production ? appUrl : 'http://localhost:' + server.address().port} in your browser.`); resolve(server); });
    server.on('error', reject);
  });
};
export async function closeResources() {
  for (const watcher of watchers) watcher.close();
  for (const client of clients) client.end();
  sessionStore.stopExpiringSessions();
  await sequelize.close();
}
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun && !process.env.XIAN_ELECTRON) {
  startServer().catch(error => { console.error('Startup failed:', error.message); process.exit(1); });
}
