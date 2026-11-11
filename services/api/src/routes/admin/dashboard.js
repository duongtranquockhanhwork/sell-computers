const express = require('express');
const db = require('../../db');
const v = require('../../lib/http');

const router = express.Router();

// Revenue = order totals actually charged (excluding cancelled orders).
// Profit  = item revenue - item cost - discount - loyalty points redeemed
//           (tax and shipping are pass-through and excluded from profit).
const ORDER_PROFIT = `
  (SELECT COALESCE(SUM(oi.line_total - oi.unit_cost * oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id)
  - o.discount_amount - o.points_discount`;

router.get('/summary', async (req, res) => {
  const [users, orders, best, monthly, status, latest] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d,
                     COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS new_month
                FROM users WHERE role = 'customer'`),
    db.query(`SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last_30d,
                     COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0) AS revenue,
                     COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled' AND created_at >= NOW() - INTERVAL '30 days'), 0) AS revenue_30d,
                     COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
                FROM orders`),
    db.query(`SELECT oi.product_id, oi.product_name, SUM(oi.quantity)::int AS quantity, SUM(oi.line_total) AS revenue
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
               WHERE o.status <> 'cancelled'
               GROUP BY oi.product_id, oi.product_name ORDER BY quantity DESC LIMIT 10`),
    db.query(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
                     COUNT(*)::int AS orders, COALESCE(SUM(total), 0) AS revenue
                FROM orders WHERE status <> 'cancelled' AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
               GROUP BY 1 ORDER BY 1`),
    db.query('SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status'),
    db.query(`SELECT order_number, full_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 6`),
  ]);
  // Actionable insights: work waiting for the administrator.
  const [lowStock, stockCounts, codes] = await Promise.all([
    db.query(`SELECT p.id AS product_id, p.name AS product_name, v.name AS variant_name, v.stock
                FROM variants v JOIN products p ON p.id = v.product_id
               WHERE v.is_active AND p.is_active AND v.stock <= 5 ORDER BY v.stock, p.name LIMIT 6`),
    db.query(`SELECT COUNT(*) FILTER (WHERE v.stock = 0)::int AS out_of_stock,
                     COUNT(*) FILTER (WHERE v.stock BETWEEN 1 AND 5)::int AS low_stock
                FROM variants v JOIN products p ON p.id = v.product_id WHERE v.is_active AND p.is_active`),
    db.query(`SELECT code, used_count, usage_limit FROM discount_codes
               WHERE usage_limit - used_count <= 2 AND used_count < usage_limit ORDER BY usage_limit - used_count, code`),
  ]);
  res.json({
    users: { total: users.rows[0].total, new30d: users.rows[0].new_30d, newThisMonth: users.rows[0].new_month },
    orders: {
      total: orders.rows[0].total,
      last30d: orders.rows[0].last_30d,
      pending: orders.rows[0].pending,
      revenue: orders.rows[0].revenue,
      revenue30d: orders.rows[0].revenue_30d,
    },
    bestSellers: best.rows.map((r) => ({ productId: r.product_id, name: r.product_name, quantity: r.quantity, revenue: r.revenue })),
    monthly: monthly.rows,
    byStatus: Object.fromEntries(status.rows.map((r) => [r.status, r.n])),
    insights: {
      toConfirm: Object.fromEntries(status.rows.map((r) => [r.status, r.n])).pending || 0,
      toShip: Object.fromEntries(status.rows.map((r) => [r.status, r.n])).confirmed || 0,
      outOfStock: stockCounts.rows[0].out_of_stock,
      lowStock: stockCounts.rows[0].low_stock,
      lowStockItems: lowStock.rows.map((r) => ({ productId: r.product_id, product: r.product_name, variant: r.variant_name, stock: r.stock })),
      codesNearlyUsed: codes.rows.map((r) => ({ code: r.code, left: r.usage_limit - r.used_count })),
    },
    latestOrders: latest.rows.map((r) => ({ orderNumber: r.order_number, fullName: r.full_name, total: r.total, status: r.status, createdAt: r.created_at })),
  });
});

const GRANULARITY = {
  year: { trunc: 'year', label: 'YYYY' },
  quarter: { trunc: 'quarter', label: 'YYYY-"Q"Q' },
  month: { trunc: 'month', label: 'YYYY-MM' },
  week: { trunc: 'week', label: 'IYYY-"W"IW' },
  day: { trunc: 'day', label: 'YYYY-MM-DD' },
};

// Local calendar date (the server runs in Asia/Ho_Chi_Minh), not UTC.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function isoDate(x, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x || ''))) throw v.badRequest(`${field} must be YYYY-MM-DD`);
  const d = new Date(`${x}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw v.badRequest(`${field} is not a valid date`);
  return d;
}

// Default ranges per view: all years, last 8 quarters, last 12 months, last 12 weeks.
function resolveRange(granularity, q) {
  const now = new Date();
  if (q.from || q.to) {
    const from = isoDate(q.from, 'from');
    const to = isoDate(q.to, 'to');
    if (from > to) throw v.badRequest('"from" must be before "to"');
    to.setDate(to.getDate() + 1); // inclusive end date
    return { from, to };
  }
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = new Date(to);
  if (granularity === 'year') return { from: new Date(2000, 0, 1), to };
  if (granularity === 'quarter') from.setMonth(Math.floor(now.getMonth() / 3) * 3 - 21, 1);
  if (granularity === 'month') from.setMonth(now.getMonth() - 11, 1);
  if (granularity === 'week') from.setDate(from.getDate() - 7 * 12);
  if (granularity === 'day') from.setDate(from.getDate() - 30);
  return { from, to };
}

router.get('/advanced', async (req, res) => {
  const granularity = GRANULARITY[req.query.granularity] ? req.query.granularity : 'year';
  const { trunc, label } = GRANULARITY[granularity];
  const { from, to } = resolveRange(granularity, req.query);
  const params = [from, to];
  const RANGE = `o.status <> 'cancelled' AND o.created_at >= $1 AND o.created_at < $2`;

  const [series, totals, categories, products] = await Promise.all([
    db.query(
      `WITH per_order AS (
         SELECT o.id, date_trunc('${trunc}', o.created_at) AS bucket, o.total, ${ORDER_PROFIT} AS profit
           FROM orders o WHERE ${RANGE}
       ), per_items AS (
         SELECT date_trunc('${trunc}', o.created_at) AS bucket,
                SUM(oi.quantity)::int AS quantity, COUNT(DISTINCT oi.category_id)::int AS product_types,
                COUNT(DISTINCT oi.product_id)::int AS distinct_products
           FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE ${RANGE} GROUP BY 1
       )
       SELECT to_char(po.bucket, '${label}') AS label, po.bucket,
              COUNT(*)::int AS orders, SUM(po.total) AS revenue, SUM(po.profit) AS profit,
              MAX(pi.quantity) AS quantity, MAX(pi.product_types) AS product_types, MAX(pi.distinct_products) AS distinct_products
         FROM per_order po LEFT JOIN per_items pi ON pi.bucket = po.bucket
        GROUP BY po.bucket ORDER BY po.bucket`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total), 0) AS revenue, COALESCE(SUM(${ORDER_PROFIT}), 0) AS profit,
              COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${RANGE}), 0)::int AS quantity
         FROM orders o WHERE ${RANGE}`,
      params,
    ),
    db.query(
      `SELECT c.name, SUM(oi.quantity)::int AS quantity, SUM(oi.line_total) AS revenue,
              SUM(oi.line_total - oi.unit_cost * oi.quantity) AS gross_profit
         FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN categories c ON c.id = oi.category_id
        WHERE ${RANGE} GROUP BY c.name ORDER BY revenue DESC`,
      params,
    ),
    db.query(
      `SELECT oi.product_name AS name, SUM(oi.quantity)::int AS quantity, SUM(oi.line_total) AS revenue
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE ${RANGE} GROUP BY oi.product_name ORDER BY quantity DESC LIMIT 10`,
      params,
    ),
  ]);
  const end = new Date(to);
  end.setDate(end.getDate() - 1);
  res.json({
    granularity,
    from: ymd(from),
    to: ymd(end),
    totals: totals.rows[0],
    series: series.rows.map((r) => ({
      label: r.label,
      orders: r.orders,
      revenue: r.revenue,
      profit: r.profit,
      quantity: r.quantity || 0,
      productTypes: r.product_types || 0,
      distinctProducts: r.distinct_products || 0,
    })),
    categories: categories.rows,
    topProducts: products.rows,
  });
});

module.exports = router;
