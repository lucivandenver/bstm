import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User } from '../models/userModel.js';
import { authenticate } from '../middleware/security.js';
import { email, registrationInput } from '../services/validation.js';
export const loginPage = (req, res) => res.render('login', { title: 'Login' });
export const registerPage = (req, res) => res.render('register', { title: 'Register' });
export const forgotPasswordPage = (req, res) => res.render('forgotpassword', { title: 'Account help' });
export const dashboardPage = (req, res) => {
  if (req.user.role === 'student') return res.redirect('/student');
  res.render('dashboard', { title: 'Dashboard' });
};
export const loginUser = async (req, res) => {
  const user = await User.findOne({ where: { email: email(req.body.email) } });
  const valid = user?.password && typeof req.body.password === 'string' &&
    Buffer.byteLength(req.body.password) <= 72 && await bcrypt.compare(req.body.password, user.password);
  if (!valid || !user.active) {
    req.flash('error_msg', 'Invalid email or password. Google accounts should use Sign in with Google.');
    return res.redirect('/login');
  }
  await authenticate(req, user);
  res.redirect('/dashboard');
};
export const registerUser = async (req, res) => {
  let data;
  try { data = registrationInput(req.body); } catch (err) {
    req.flash('error_msg', err.message); return res.redirect('/register');
  }
  if (await User.findOne({ where: { [Op.or]: [{ email: data.email }, { studentId: data.studentId }] } })) {
    req.flash('error_msg', 'That email or Student ID is already registered. Please sign in.');
    return res.redirect('/register');
  }
  let user;
  try { user = await User.create({ ...data, password: await bcrypt.hash(req.body.password, 12), role: 'student' }); }
  catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    req.flash('error_msg', 'That email or Student ID is already registered.'); return res.redirect('/register');
  }
  await authenticate(req, user);
  res.redirect('/student/profile');
};
export const logoutUser = (req, res, next) => req.session.destroy(err => {
  if (err) return next(err);
  res.clearCookie('careerbridge.sid'); res.redirect('/login');
});
