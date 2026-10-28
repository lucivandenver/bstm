import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/userModel.js';
import { googleReady, appUrl } from '../config/env.js';
import { googleDiagnostic } from '../services/googleDiagnostics.js';
import { authenticate } from '../middleware/security.js';
import { ownerEmail, usable, accessMessage, destination, audit } from '../services/accounts.js';
const client = () => new OAuth2Client({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI || `${appUrl}/auth/google/callback` });
const loginError = (req, res, message) => { req.flash('error_msg', message); return res.redirect('/?auth=login'); };
export const googleStart = (req, res, next) => {
  if (!googleReady()) return loginError(req, res, 'Google sign-in is not configured yet.');
  const state = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url');
  const intent = req.user ? 'link' : req.query.intent === 'register' ? 'register' : 'login';
  const role = req.query.role === 'faculty' ? 'faculty' : 'student';
  if (intent === 'register') delete req.session.pendingRegistration;
  req.session.oauth = { state, nonce, verifier, intent, role, linkUserId: req.user?.id || null, expires: Date.now() + 10 * 60 * 1000 };
  const url = client().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  req.session.save(err => err ? next(err) : res.redirect(url));
};
export const googleCallback = async (req, res) => {
  const flow = req.session.oauth; delete req.session.oauth;
  const state = req.query.state;
  const valid = flow && typeof state === 'string' && /^[a-f0-9]{64}$/.test(state) && timingSafeEqual(Buffer.from(state), Buffer.from(flow.state));
  if (!valid || flow.expires < Date.now() || req.query.error || typeof req.query.code !== 'string') return loginError(req, res, 'Google sign-in was cancelled or expired. Please try again.');
  let stage = 'exchange-token';
  try {
    const oauth = client();
    const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: flow.verifier });
    stage = 'verify-token';
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    stage = 'check-identity';
    const p = ticket.getPayload();
    if (!p || p.nonce !== flow.nonce || p.email_verified !== true || !p.email || !p.sub) throw new Error('Invalid identity');
    stage = 'database';
    const address = p.email.toLowerCase();
    let user = await User.findOne({ where: { googleId: p.sub } });
    const emailUser = await User.findOne({ where: { email: address } });
    if (flow.intent === 'link') {
      if (req.session.userId !== flow.linkUserId) throw new Error('Account changed');
      const existing = await User.findByPk(flow.linkUserId);
      if (!usable(existing) || existing.email !== address || (existing.googleId && existing.googleId !== p.sub) || (user && user.id !== existing.id)) return loginError(req, res, 'Choose the Google account with the same email as your existing account.');
      await existing.update({ googleId: p.sub, emailVerified: true });
      await audit(existing.id, 'account.google_connected', 'user', existing.id);
      req.flash('success_msg', 'Google account connected.'); return res.redirect(`${destination(existing)}/profile`);
    }
    if (flow.intent === 'register') {
      if (user || emailUser || address === ownerEmail()) return loginError(req, res, 'This account is already registered or reserved. Please sign in.');
      req.session.pendingRegistration = { sub: p.sub, email: address, name: p.name || '', role: flow.role, expires: Date.now() + 10 * 60 * 1000 };
      return res.redirect(`/register?role=${flow.role}`);
    }
    // The pre-provisioned owner is the only account that can bind Google by email
    // without first signing in with a password. Its Gmail identity is verified above.
    if (!user && emailUser?.role === 'admin' && address === ownerEmail() && address.endsWith('@gmail.com') && !emailUser.googleId) {
      await emailUser.update({ googleId: p.sub, emailVerified: true }); user = emailUser;
    }
    if (!user) return loginError(req, res, emailUser ? 'This account uses a password. Sign in with it first, then connect Google from your profile.' : 'This account is not yet registered. Please register first.');
    if (!usable(user)) return loginError(req, res, accessMessage(user));
    stage = 'session';
    await authenticate(req, user, 'google'); await audit(user.id, 'account.login', 'user', user.id, { method: 'google' });
    res.redirect('/dashboard');
  } catch (error) {
    const diagnostic = googleDiagnostic(error, stage);
    const reference = randomUUID().slice(0, 8);
    console.error('[Google sign-in]', JSON.stringify({ reference, stage, code: diagnostic.code }));
    return loginError(req, res, `${diagnostic.message} Error: ${diagnostic.code}. Reference: ${reference}.`);
  }
};
