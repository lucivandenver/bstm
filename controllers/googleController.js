import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/userModel.js';
import { googleReady, appUrl } from '../config/env.js';
import { googleDiagnostic } from '../services/googleDiagnostics.js';
import { authenticate } from '../middleware/security.js';
const client = () => new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${appUrl}/auth/google/callback`);
export const googleStart = (req, res, next) => {
  if (!googleReady()) {
    req.flash('error_msg', 'Google sign-in is not configured yet. See docs/STUDENT_SETUP.md or use email signup.');
    return res.redirect('/login');
  }
  const state = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const verifier = randomBytes(48).toString('base64url');
  const linkUserId = req.user?.id || null;
  req.session.oauth = { state, nonce, verifier, linkUserId, expires: Date.now() + 10 * 60 * 1000 };
  const url = client().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account' });
  req.session.save(err => err ? next(err) : res.redirect(url));
};
export const googleCallback = async (req, res) => {
  const flow = req.session.oauth;
  delete req.session.oauth;
  const state = req.query.state;
  const sameState = flow && typeof state === 'string' && /^[a-f0-9]{64}$/.test(state) &&
    timingSafeEqual(Buffer.from(state), Buffer.from(flow.state));
  if (!sameState || flow.expires < Date.now() || req.query.error || typeof req.query.code !== 'string') {
    req.flash('error_msg', 'Google sign-in was cancelled or expired. Please try again.'); return res.redirect('/login');
  }
  let stage = 'exchange-token';
  try {
    const oauth = client();
    const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: flow.verifier });
    stage = 'verify-token';
    const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    stage = 'check-identity';
    const p = ticket.getPayload();
    if (!p || p.nonce !== flow.nonce || !p.email_verified || !p.email || !p.sub) throw new Error('Invalid Google identity');
    // Never auto-link an existing password account merely by matching email.
    stage = 'database';
    let user = await User.findOne({ where: { googleId: p.sub } });
    if (flow.linkUserId) {
      if (req.session.userId !== flow.linkUserId) throw Object.assign(new Error('Account session changed'), { signinCode: 'ACCOUNT_LINK' });
      const existing = await User.findByPk(flow.linkUserId);
      if (!existing?.active || (existing.googleId && existing.googleId !== p.sub) || existing.email.toLowerCase() !== p.email.toLowerCase() || (user && user.id !== existing.id)) throw Object.assign(new Error('Account link failed'), { signinCode: 'ACCOUNT_LINK' });
      await existing.update({ googleId: p.sub, emailVerified: true });
      req.flash('success_msg', 'Google account connected. You can now sign in with Google.');
      return res.redirect('/student/profile');
    }
    if (!user) {
      if (await User.findOne({ where: { email: p.email.toLowerCase() } })) {
        req.flash('error_msg', 'This email already has an account. Sign in with your password, then connect Google in My Profile.');
        return res.redirect('/login');
      }
      user = await User.create({ name: p.name || p.email.split('@')[0], email: p.email.toLowerCase(), googleId: p.sub,
        emailVerified: true, password: null, role: 'student' });
    }
    if (!user.active) throw Object.assign(new Error('Account unavailable'), { signinCode: 'ACCOUNT_DISABLED' });
    stage = 'session';
    await authenticate(req, user);
    res.redirect('/dashboard');
  } catch (error) {
    const diagnostic = googleDiagnostic(error, stage);
    const reference = randomUUID().slice(0, 8);
    console.error('[Google sign-in]', JSON.stringify({ reference, stage, code: diagnostic.code }));
    req.flash('error_msg', `${diagnostic.message} Error: ${diagnostic.code}. Reference: ${reference}.`);
    res.redirect('/login');
  }
};
