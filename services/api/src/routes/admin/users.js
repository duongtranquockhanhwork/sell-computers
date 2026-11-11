const express = require('express');
const db = require('../../db');
const v = require('../../lib/http');
const { addressDto } = require('../../lib/users');

const router = express.Router();

router.get('/users', async (req, res) => {
  const page = v.int(req.query.page, { field: 'page', min: 1, fallback: 1 });
  const limit = 20;
  const params = [];
  const where = [];
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(u.email ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1)`);
  }
  if (req.query.status === 'banned') where.push('u.is_banned');
  if (req.query.status === 'active') where.push('NOT u.is_banned');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [list, count] = await Promise.all([
    db.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.is_banned, u.loyalty_points, u.created_at,
              (u.google_id IS NOT NULL) AS has_google,
              COUNT(o.id)::int AS order_count, COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS total_spent
         FROM users u LEFT JOIN orders o ON o.user_id = u.id ${w}
        GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM users u ${w}`, params),
  ]);
  res.json({ items: list.rows, total: count.rows[0].n, page, totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)) });
});

router.get('/users/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const { rows } = await db.query(
    `SELECT id, email, full_name, phone, role, is_banned, loyalty_points, created_at, (google_id IS NOT NULL) AS has_google
       FROM users WHERE id = $1`,
    [id],
  );
  if (!rows.length) throw v.notFound('User not found');
  const [addresses, orders] = await Promise.all([
    db.query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id', [id]),
    db.query('SELECT order_number, total, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
  ]);
  res.json({ user: rows[0], addresses: addresses.rows.map(addressDto), orders: orders.rows });
});

router.put('/users/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const fullName = v.str(req.body.fullName, { field: 'Full name', min: 2, max: 120 });
  const email = v.email(req.body.email);
  const phone = v.phone(req.body.phone, 'Phone', false);
  const { rows } = await db.query(
    'UPDATE users SET full_name = $2, email = $3, phone = $4, updated_at = NOW() WHERE id = $1 RETURNING id',
    [id, fullName, email, phone],
  );
  if (!rows.length) throw v.notFound('User not found');
  res.json({ ok: true });
});

router.post('/users/:id/ban', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const banned = req.body.banned !== false;
  const { rows } = await db.query(
    `UPDATE users SET is_banned = $2, updated_at = NOW() WHERE id = $1 AND role = 'customer' RETURNING is_banned`,
    [id, banned],
  );
  if (!rows.length) throw v.badRequest('Only customer accounts can be banned');
  res.json({ isBanned: rows[0].is_banned });
});

module.exports = router;
