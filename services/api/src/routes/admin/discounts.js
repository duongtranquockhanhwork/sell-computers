const crypto = require('crypto');
const express = require('express');
const db = require('../../db');
const v = require('../../lib/http');
const { normalizeCode, isValidCodeFormat } = require('../../lib/pricing');

const router = express.Router();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  return Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
}

router.get('/discounts', async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status <> 'cancelled'), 0) AS total_discounted,
            COUNT(o.id)::int AS order_count
       FROM discount_codes d LEFT JOIN orders o ON o.discount_code_id = d.id
      GROUP BY d.id ORDER BY d.created_at DESC, d.id DESC`,
  );
  res.json({ items: rows });
});

router.get('/discounts/:id/orders', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const d = await db.query('SELECT * FROM discount_codes WHERE id = $1', [id]);
  if (!d.rows.length) throw v.notFound('Discount code not found');
  const { rows } = await db.query(
    `SELECT order_number, full_name, email, subtotal, discount_amount, total, status, created_at
       FROM orders WHERE discount_code_id = $1 ORDER BY created_at DESC`,
    [id],
  );
  res.json({ discount: d.rows[0], orders: rows });
});

router.post('/discounts', async (req, res) => {
  const type = req.body.type === 'fixed' ? 'fixed' : 'percent';
  const value = type === 'percent'
    ? v.int(req.body.value, { field: 'Percentage', min: 1, max: 100 })
    : v.int(req.body.value, { field: 'Amount', min: 1000, max: 1e9 });
  const usageLimit = v.int(req.body.usageLimit, { field: 'Usage limit', min: 1, max: 10 });
  let code = normalizeCode(req.body.code);
  if (code && !isValidCodeFormat(code)) throw v.badRequest('A code must be exactly 5 letters or digits');
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = code || randomCode();
    try {
      const { rows } = await db.query(
        'INSERT INTO discount_codes (code, type, value, usage_limit) VALUES ($1, $2, $3, $4) RETURNING *',
        [candidate, type, value, usageLimit],
      );
      return res.status(201).json({ discount: rows[0] });
    } catch (err) {
      if (err.code !== '23505') throw err;
      if (code) throw v.conflict(`Code ${code} already exists`);
    }
  }
  throw v.conflict('Could not generate a unique code, please try again');
});

module.exports = router;
