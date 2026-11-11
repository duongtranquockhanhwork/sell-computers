const express = require('express');
const db = require('../../db');
const mq = require('../../mq');
const v = require('../../lib/http');
const catalog = require('../../lib/catalog');
const { broadcast } = require('../../redis');
const { loadOrder } = require('../orders');

const router = express.Router();

// Allowed status transitions processed by the administrator.
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping: ['delivered'],
  delivered: [],
  cancelled: [],
};

function rangeClause(range, from, to, params) {
  const add = (sql) => sql;
  switch (range) {
    case 'today': return add(`o.created_at >= date_trunc('day', NOW())`);
    case 'yesterday': return add(`o.created_at >= date_trunc('day', NOW()) - INTERVAL '1 day' AND o.created_at < date_trunc('day', NOW())`);
    case 'week': return add(`o.created_at >= date_trunc('week', NOW())`);
    case 'month': return add(`o.created_at >= date_trunc('month', NOW())`);
    case 'custom': {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(String(from || '')) || !re.test(String(to || ''))) throw v.badRequest('Choose a start and end date');
      params.push(from, to);
      return `o.created_at >= $${params.length - 1}::date AND o.created_at < $${params.length}::date + INTERVAL '1 day'`;
    }
    default: return null;
  }
}

router.get('/orders', async (req, res) => {
  const page = v.int(req.query.page, { field: 'page', min: 1, fallback: 1 });
  const limit = 20;
  const params = [];
  const where = [];
  const range = rangeClause(req.query.range, req.query.from, req.query.to, params);
  if (range) where.push(range);
  if (req.query.status && TRANSITIONS[req.query.status]) {
    params.push(req.query.status);
    where.push(`o.status = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(o.order_number ILIKE $${params.length} OR o.full_name ILIKE $${params.length} OR o.email ILIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [list, count] = await Promise.all([
    db.query(
      `SELECT o.id, o.order_number, o.full_name, o.email, o.total, o.status, o.payment_method, o.payment_status,
              o.discount_amount, d.code AS discount_code, o.created_at,
              (SELECT SUM(quantity) FROM order_items oi WHERE oi.order_id = o.id)::int AS item_count
         FROM orders o LEFT JOIN discount_codes d ON d.id = o.discount_code_id ${w}
        ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    ),
    db.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0) AS sum FROM orders o ${w}`, params),
  ]);
  res.json({
    items: list.rows,
    total: count.rows[0].n,
    sum: count.rows[0].sum,
    page,
    totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)),
  });
});

router.get('/orders/:number', async (req, res) => {
  const order = await loadOrder('o.order_number = $1', [String(req.params.number)]);
  if (!order) throw v.notFound('Order not found');
  res.json({ order, nextStatuses: TRANSITIONS[order.status] });
});

router.patch('/orders/:number/status', async (req, res) => {
  const status = String(req.body.status || '');
  const note = v.str(req.body.note, { field: 'Note', max: 300, required: false });
  const changed = await db.tx(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE order_number = $1 FOR UPDATE', [String(req.params.number)]);
    const o = rows[0];
    if (!o) throw v.notFound('Order not found');
    if (!TRANSITIONS[o.status].includes(status)) {
      throw v.badRequest(`An order that is "${o.status}" cannot become "${status}"`);
    }
    await client.query('UPDATE orders SET status = $2 WHERE id = $1', [o.id, status]);
    if (status === 'delivered' && o.payment_method === 'cod') {
      await client.query(`UPDATE orders SET payment_status = 'paid' WHERE id = $1`, [o.id]);
    }
    await client.query(
      'INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1, $2, $3, $4)',
      [o.id, status, note, req.user.id],
    );
    let productIds = [];
    if (status === 'cancelled') {
      // Put items back on the shelf and undo the loyalty movement of this order.
      const items = await client.query('SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1', [o.id]);
      for (const it of items.rows) {
        if (it.variant_id) await client.query('UPDATE variants SET stock = stock + $2 WHERE id = $1', [it.variant_id, it.quantity]);
        if (it.product_id) await client.query('UPDATE products SET sold_count = GREATEST(0, sold_count - $2) WHERE id = $1', [it.product_id, it.quantity]);
      }
      productIds = items.rows.map((i) => i.product_id).filter(Boolean);
      await client.query(
        'UPDATE users SET loyalty_points = GREATEST(0, loyalty_points + $2 - $3) WHERE id = $1',
        [o.user_id, o.points_used, o.points_earned],
      );
      if (o.discount_code_id) {
        await client.query('UPDATE discount_codes SET used_count = GREATEST(0, used_count - 1) WHERE id = $1', [o.discount_code_id]);
      }
    }
    return { o, productIds };
  });
  const order = await loadOrder('o.id = $1', [changed.o.id]);
  mq.sendEmail(order.email, 'order-status', { order });
  broadcast(`user:${order.userId}`, 'order:status', { orderNumber: order.orderNumber, status: order.status });
  if (changed.productIds.length) catalog.publishProductChanges(changed.productIds);
  res.json({ order, nextStatuses: TRANSITIONS[order.status] });
});

module.exports = router;
