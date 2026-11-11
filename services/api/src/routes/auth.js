const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const mq = require('../mq');
const { rateLimit } = require('../redis');
const v = require('../lib/http');
const { parseAddress, insertAddress } = require('../lib/users');
const {
  issueToken, clearToken, requireAuth, publicUser, createPasswordToken, hashToken,
} = require('../auth');

const router = express.Router();

const authLimiter = rateLimit({ name: 'auth', limit: 10, windowSeconds: 60 });
const mailLimiter = rateLimit({ name: 'mail', limit: 5, windowSeconds: 600 });

// Registration only asks for e-mail, full name and a shipping address.
// The account owner then chooses a password through the e-mailed link.
router.post('/register', mailLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const fullName = v.str(req.body.fullName, { field: 'Full name', min: 2, max: 120 });
  const address = parseAddress({ ...req.body.address, recipient: req.body.address?.recipient || fullName });

  const link = await db.tx(async (client) => {
    const exists = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.rowCount) throw v.conflict('An account with this email already exists. Try signing in or recovering your password.');
    const { rows } = await client.query(
      'INSERT INTO users (email, full_name, phone) VALUES ($1, $2, $3) RETURNING id',
      [email, fullName, address.phone],
    );
    await insertAddress(client, rows[0].id, address, true);
    return createPasswordToken(client, rows[0].id, 'setup');
  });

  mq.sendEmail(email, 'account-setup', { fullName, link });
  res.status(201).json({ message: 'Account created. Check your inbox for a link to set your password.' });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = user && user.password_hash && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    if (user && !user.password_hash) {
      throw v.unauthorized('This account has no password yet. Use the link in your email or "Forgot password".');
    }
    throw v.unauthorized('Incorrect email or password');
  }
  if (user.is_banned) throw v.forbidden('This account has been suspended. Please contact support.');
  issueToken(res, user);
  res.json({ user: publicUser({ ...user, has_password: true, has_google: Boolean(user.google_id) }) });
});

router.post('/logout', (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

// Always answers the same way so the endpoint cannot be used to probe accounts.
router.post('/forgot-password', mailLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const { rows } = await db.query('SELECT id, full_name, is_banned FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (user && !user.is_banned) {
    const link = await createPasswordToken(db, user.id, 'reset');
    mq.sendEmail(email, 'password-reset', { fullName: user.full_name, link });
  }
  res.json({ message: 'If an account exists for this email, a recovery link has been sent.' });
});

// Completes either the first-time password setup or a password reset.
router.post('/set-password', authLimiter, async (req, res) => {
  const password = v.password(req.body.password);
  const tokenHash = hashToken(v.str(req.body.token, { field: 'Token', max: 128 }));
  const user = await db.tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE password_tokens SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id`,
      [tokenHash],
    );
    if (!rows.length) throw v.badRequest('This link is invalid or has expired. Request a new one.');
    const hash = await bcrypt.hash(password, 10);
    const updated = await client.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [rows[0].user_id, hash],
    );
    // Any other outstanding links for this user become useless.
    await client.query('UPDATE password_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [rows[0].user_id]);
    return updated.rows[0];
  });
  if (user.is_banned) throw v.forbidden('This account has been suspended.');
  issueToken(res, user);
  res.json({ user: publicUser({ ...user, has_password: true, has_google: Boolean(user.google_id) }) });
});

router.post('/change-password', requireAuth, authLimiter, async (req, res) => {
  const next = v.password(req.body.newPassword, 'New password');
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const current = rows[0].password_hash;
  if (current) {
    const ok = await bcrypt.compare(String(req.body.currentPassword || ''), current);
    if (!ok) throw v.badRequest('Current password is incorrect');
    if (await bcrypt.compare(next, current)) throw v.badRequest('New password must differ from the current one');
  }
  await db.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [
    req.user.id,
    await bcrypt.hash(next, 10),
  ]);
  res.json({ message: 'Password updated' });
});

// ---------- Google OAuth 2.0 (authorization code flow) ----------
router.get('/google', (req, res) => {
  if (!config.google.enabled) throw new v.HttpError(503, 'Google sign-in is not configured on this server');
  // CSRF protection: a short-lived signed state stored in a cookie and echoed by Google.
  const state = jwt.sign({ n: Math.random().toString(36).slice(2), r: String(req.query.redirect || '/') }, config.jwtSecret, { expiresIn: 600 });
  res.cookie('th_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 600000, path: '/api/auth' });
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const fail = (reason) => res.redirect(`${config.publicUrl}/login?error=${encodeURIComponent(reason)}`);
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies.th_oauth_state) return fail('Google sign-in was cancelled or expired');
    const { r: redirectTo } = jwt.verify(state, config.jwtSecret);
    res.clearCookie('th_oauth_state', { path: '/api/auth' });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('Google rejected the sign-in request');
    const { access_token: accessToken } = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const info = await infoRes.json();
    if (!info.email || !info.email_verified) return fail('Your Google account email is not verified');

    const email = info.email.toLowerCase();
    const user = await db.tx(async (client) => {
      const found = await client.query('SELECT * FROM users WHERE google_id = $1 OR email = $2 ORDER BY (google_id = $1) DESC LIMIT 1', [info.sub, email]);
      if (found.rows[0]) {
        const u = found.rows[0];
        if (!u.google_id) await client.query('UPDATE users SET google_id = $2 WHERE id = $1', [u.id, info.sub]);
        return u;
      }
      const created = await client.query(
        'INSERT INTO users (email, full_name, google_id) VALUES ($1, $2, $3) RETURNING *',
        [email, info.name || email.split('@')[0], info.sub],
      );
      return created.rows[0];
    });
    if (user.is_banned) return fail('This account has been suspended');
    issueToken(res, user);
    const safeRedirect = redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/';
    res.redirect(`${config.publicUrl}${safeRedirect}`);
  } catch (err) {
    console.error('[auth] google callback failed', err.message);
    fail('Google sign-in failed');
  }
});

module.exports = router;
