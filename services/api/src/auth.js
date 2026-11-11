// Stateless authentication: a signed JWT in an httpOnly cookie. Any API replica
// can verify it, so requests can be load-balanced without sticky sessions.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { unauthorized, forbidden } = require('./lib/http');

const COOKIE = 'th_token';

function issueToken(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.jwtTtlSeconds * 1000,
    path: '/',
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Loads req.user when a valid cookie is present; never rejects.
async function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  req.user = null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await db.query(
      `SELECT id, email, full_name, phone, role, is_banned, loyalty_points,
              (password_hash IS NOT NULL) AS has_password, (google_id IS NOT NULL) AS has_google,
              created_at
         FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = rows[0];
    if (user && !user.is_banned) req.user = user;
  } catch {
    // Invalid or expired token: treat as anonymous.
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden());
  next();
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    phone: u.phone,
    role: u.role,
    loyaltyPoints: u.loyalty_points,
    hasPassword: u.has_password,
    hasGoogle: u.has_google,
    createdAt: u.created_at,
  };
}

// One-time tokens are stored hashed; only the e-mailed link carries the raw value.
function newOneTimeToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

async function createPasswordToken(client, userId, purpose) {
  const { raw, hash } = newOneTimeToken();
  const hours = purpose === 'setup' ? 72 : 1;
  await client.query(
    `INSERT INTO password_tokens (user_id, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::interval)`,
    [userId, hash, purpose, String(hours)],
  );
  return `${config.publicUrl}/set-password?token=${raw}&purpose=${purpose}`;
}

module.exports = {
  COOKIE, issueToken, clearToken, loadUser, requireAuth, requireAdmin,
  publicUser, createPasswordToken, hashToken,
};
