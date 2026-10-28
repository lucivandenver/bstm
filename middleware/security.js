import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Op } from 'sequelize';
import { Announcement } from '../models/adminModels.js';
import { usable, setting } from '../services/accounts.js';
import { User } from '../models/userModel.js';
export const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export function csrf(req, res, next) {
  req.session.csrf ||= randomBytes(32).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const token = req.body?._csrf || req.get('x-csrf-token');
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) {
      return res.status(403).send('This form expired. Reload the page and try again.');
    }
  }
  next();
}
export const requireUser = asyncRoute(async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = await User.findByPk(req.session.userId);
  if (!usable(user) || (req.session.sessionVersion || 0) !== user.sessionVersion) return req.session.destroy(() => res.redirect('/login'));
  req.user = user;
  const { password, googleId, ...safeUser } = user.get({ plain: true });
  res.locals.currentUser = safeUser;
  res.locals.institutionName = await setting('institutionName', 'MinSU Bongabong Campus');
  res.locals.portalAnnouncements = (await Announcement.findAll({ where: { published: true, audience: { [Op.in]: ['all', user.role] } }, order: [['createdAt', 'DESC']], limit: 3 })).map(a => ({ title: a.title, body: a.body }));
  res.set('Cache-Control', 'no-store');
  next();
});
export const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).send('Administrator access required.');
export const requireFaculty = (req, res, next) => req.user.role === 'faculty' ? next() : res.status(403).send('Faculty access required.');
export const requireStudent = (req, res, next) => {
  if (req.user.role !== 'student') return res.status(403).send('This area is available to student accounts.');
  next();
};
export function authenticate(req, user, method = 'password') {
  return new Promise((resolve, reject) => req.session.regenerate(err => {
    if (err) return reject(err);
    req.session.userId = user.id;
    req.session.sessionVersion = user.sessionVersion;
    req.session.authMethod = method;
    req.session.loginAt = Date.now();
    req.session.save(err => err ? reject(err) : resolve());
  }));
}
