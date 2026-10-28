import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { Section } from '../models/adminModels.js';
import { authenticate } from '../middleware/security.js';
import { email, registrationInput } from '../services/validation.js';
import { ownerEmail, usable, accessMessage, destination, setting, audit } from '../services/accounts.js';
export const loginPage = (req, res) => res.render('login', { title: 'Login' });
export const registerPage = async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (pending && pending.expires < Date.now()) delete req.session.pendingRegistration;
  const google = req.session.pendingRegistration;
  const role = google?.role || (req.query.role === 'faculty' ? 'faculty' : 'student');
  res.render('register', { title: 'Register', isFaculty: role === 'faculty', registrationRole: role,
    pendingGoogle: Boolean(google), registrationName: google?.name || '', registrationEmail: google?.email || '',
    sections: (await Section.findAll({ where: { active: true }, order: [['name', 'ASC']] })).map(s => s.get({ plain: true })) });
};
export const forgotPasswordPage = (req, res) => res.render('forgotpassword', { title: 'Account help' });
export const dashboardPage = (req, res) => res.redirect(destination(req.user));
export const loginUser = async (req, res) => {
  const user = await User.findOne({ where: { email: email(req.body.email) } });
  const valid = user?.password && typeof req.body.password === 'string' && Buffer.byteLength(req.body.password) <= 72 && await bcrypt.compare(req.body.password, user.password);
  if (!valid) { req.flash('error_msg', 'Invalid email or password. Google-only accounts should use Sign in with Google.'); return res.redirect('/login'); }
  if (!usable(user)) { req.flash('error_msg', accessMessage(user)); return res.redirect('/login'); }
  await authenticate(req, user);
  await audit(user.id, 'account.login', 'user', user.id, { method: 'password' });
  res.redirect('/dashboard');
};
export const registerUser = async (req, res) => {
  let data;
  const google = req.session.pendingRegistration;
  try {
    if (google && google.expires < Date.now()) { delete req.session.pendingRegistration; throw new Error('Google registration expired. Start again.'); }
    data = registrationInput(req.body, google);
    if (data.email === ownerEmail()) throw new Error('This email is reserved for the system administrator. Use administrator sign-in.');
    if (await setting('registrationEnabled', 'true') !== 'true') throw new Error('Registration is currently closed.');
    if (data.role === 'faculty' && await setting('facultyRegistrationEnabled', 'true') !== 'true') throw new Error('Faculty registration is currently closed.');
    if (data.role === 'student' && !await Section.findOne({ where: { name: data.section, active: true } })) throw new Error('Choose an available section.');
  } catch (err) { req.flash('error_msg', err.message); return res.redirect('/register?role=' + (req.body.account_type === 'faculty' ? 'faculty' : 'student')); }
  const identities = [{ email: data.email }, ...(data.studentId ? [{ studentId: data.studentId }] : [{ facultyId: data.facultyId }]), ...(google ? [{ googleId: google.sub }] : [])];
  if (await User.findOne({ where: { [Op.or]: identities } })) { req.flash('error_msg', 'That email or institutional ID is already registered. Please sign in.'); return res.redirect('/register?role=' + (req.body.account_type === 'faculty' ? 'faculty' : 'student')); }
  let user;
  try { user = await User.create({ ...data, password: google ? null : await bcrypt.hash(req.body.password, 12), googleId: google?.sub || null, emailVerified: Boolean(google), active: true }); }
  catch (err) { if (err.name !== 'SequelizeUniqueConstraintError') throw err; req.flash('error_msg', 'That email or ID is already registered.'); return res.redirect('/register?role=' + (req.body.account_type === 'faculty' ? 'faculty' : 'student')); }
  delete req.session.pendingRegistration;
  await audit(user.id, 'account.registered', 'user', user.id, { role: user.role, method: google ? 'google' : 'password' });
  if (user.role === 'faculty') { req.flash('success_msg', 'Faculty registration submitted. An administrator must approve your account before sign-in.'); return res.redirect('/login'); }
  await authenticate(req, user, google ? 'google' : 'password');
  res.redirect('/student/profile');
};
export const cancelGoogleRegistration = (req, res) => { delete req.session.pendingRegistration; res.redirect('/register'); };
export const logoutUser = (req, res, next) => req.session.destroy(err => {
  if (err) return next(err); res.clearCookie('careerbridge.sid'); res.redirect('/login');
});
