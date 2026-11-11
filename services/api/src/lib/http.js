// Small helpers for validation and consistent error responses.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const unauthorized = (msg = 'Please sign in to continue') => new HttpError(401, msg);
const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{9,15}$/;

function str(value, { field, min = 0, max = 255, required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!v) {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  if (v.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return v;
}

function email(value, field = 'Email') {
  const v = str(value, { field, max: 255 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw badRequest(`${field} is not a valid email address`);
  return v;
}

function phone(value, field = 'Phone', required = true) {
  const v = str(value, { field, max: 20, required });
  if (v === null) return null;
  const compact = v.replace(/[\s.-]/g, '');
  if (!PHONE_RE.test(compact)) throw badRequest(`${field} must contain 9-15 digits`);
  return compact;
}

function int(value, { field, min = -Infinity, max = Infinity, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} must be an integer`);
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}`);
  return n;
}

function password(value, field = 'Password') {
  const v = typeof value === 'string' ? value : '';
  if (v.length < 8 || v.length > 72) throw badRequest(`${field} must be 8-72 characters`);
  if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) throw badRequest(`${field} must contain letters and digits`);
  return v;
}

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Image must be smaller than 3 MB' });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'A record with the same unique value already exists' });
  }
  console.error('[api] unhandled error', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
  str, email, phone, int, password, slugify, errorHandler,
};
