// Cart pricing preview and checkout. The browser keeps the cart; the server is the
// single source of truth for prices, stock, discount validity and loyalty points.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const mq = require('../mq');
const v = require('../lib/http');
const pricing = require('../lib/pricing');
const catalog = require('../lib/catalog');
const { requireAuth, createPasswordToken } = require('../auth');
const { rateLimit, broadcast } = require('../redis');
const { parseAddress, formatAddress, insertAddress } = require('../lib/users');

const router = express.Router();
const checkoutLimiter = rateLimit({ name: 'checkout', limit: 10, windowSeconds: 300 });

function parseItems(raw) {
  if (!Array.isArray(raw)) throw v.badRequest('Cart items are required');
  const merged = new Map();
  for (const it of raw.slice(0, 50)) {
    const variantId = v.int(it.variantId, { field: 'variantId', min: 1 });
    const quantity = v.int(it.quantity, { field: 'quantity', min: 1, max: 99 });
    merged.set(variantId, Math.min(99, (merged.get(variantId) || 0) + quantity));
  }
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

async function loadVariants(client, ids, lock = false) {
  const { rows } = await client.query(
    `SELECT v.id, v.name, v.price, v.cost_price, v.stock, v.is_active, v.product_id,
            p.name AS product_name, p.slug, p.category_id, p.is_active AS product_active,
            (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position, id LIMIT 1) AS image
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ANY($1) ${lock ? 'FOR UPDATE OF v' : ''}`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function discountStatus(row, code) {
  if (!code) return null;
  if (!pricing.isValidCodeFormat(code)) return { code, valid: false, message: 'Codes are 5 letters or digits' };
  if (!row) return { code, valid: false, message: 'This discount code does not exist' };
  if (row.used_count >= row.usage_limit) return { code, valid: false, message: 'This code has reached its usage limit' };
  return {
    code: row.code,
    valid: true,
    type: row.type,
    value: Number(row.value),
    remainingUses: row.usage_limit - row.used_count,
    message: row.type === 'percent' ? `${row.value}% off the subtotal` : `${Number(row.value).toLocaleString('en-US')}₫ off the subtotal`,
  };
}

async function buildQuote(client, { items, discountCode, pointsToUse, user, lock = false }) {
  const variants = await loadVariants(client, items.map((i) => i.variantId), lock);
  const lines = items.map((it) => {
    const row = variants.get(it.variantId);
    if (!row || !row.is_active || !row.product_active) {
      return { variantId: it.variantId, available: false, quantity: it.quantity, message: 'This item is no longer available' };
    }
    const enough = row.stock >= it.quantity;
    return {
      variantId: row.id,
      productId: row.product_id,
      productName: row.product_name,
      slug: row.slug,
      variantName: row.name,
      image: row.image,
      categoryId: row.category_id,
      unitPrice: Number(row.price),
      unitCost: Number(row.cost_price),
      quantity: it.quantity,
      stock: row.stock,
      lineTotal: Number(row.price) * it.quantity,
      available: enough,
      message: enough ? null : row.stock === 0 ? 'Out of stock' : `Only ${row.stock} left in stock`,
    };
  });

  const code = pricing.normalizeCode(discountCode);
  let discountRow = null;
  if (code && pricing.isValidCodeFormat(code)) {
    const r = await client.query(`SELECT * FROM discount_codes WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`, [code]);
    discountRow = r.rows[0] || null;
  }
  const discount = discountStatus(discountRow, code);

  const priced = lines.filter((l) => l.available);
  const summary = pricing.computeQuote({
    lines: priced,
    discount: discount?.valid ? discountRow : null,
    pointsRequested: user ? pointsToUse : 0,
    pointsAvailable: user ? user.loyalty_points : 0,
  });
  return { lines, summary, discount, discountRow, pointsAvailable: user ? user.loyalty_points : 0 };
}

function publicLine(l) {
  const { unitCost, categoryId, ...rest } = l;
  return rest;
}

router.post('/cart/quote', async (req, res) => {
  const items = parseItems(req.body.items || []);
  const q = await buildQuote(db, {
    items,
    discountCode: req.body.discountCode,
    pointsToUse: req.body.pointsToUse,
    user: req.user,
  });
  res.json({
    lines: q.lines.map(publicLine),
    summary: q.summary,
    discount: q.discount,
    pointsAvailable: q.pointsAvailable,
    pointValue: pricing.POINT_VALUE,
    freeShippingThreshold: pricing.FREE_SHIPPING_THRESHOLD,
    taxRate: pricing.TAX_RATE,
  });
});

function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Simulated payment step. Card data is validated and immediately discarded;
// only the last four digits are kept in the order note.
function processPayment(method, payment = {}) {
  if (method === 'cod') return { status: 'unpaid', note: 'Cash on delivery' };
  if (method === 'bank_transfer') return { status: 'paid', note: 'Bank transfer (simulated)' };
  if (method === 'card') {
    const number = String(payment.cardNumber || '').replace(/\s+/g, '');
    if (!/^[0-9]{13,19}$/.test(number) || !luhn(number)) throw v.badRequest('Card number is not valid');
    if (!/^(0[1-9]|1[0-2])\/[0-9]{2}$/.test(String(payment.expiry || ''))) throw v.badRequest('Expiry must be MM/YY');
    const [mm, yy] = payment.expiry.split('/').map(Number);
    const exp = new Date(2000 + yy, mm, 1);
    if (exp <= new Date()) throw v.badRequest('Card has expired');
    if (!/^[0-9]{3,4}$/.test(String(payment.cvc || ''))) throw v.badRequest('CVC must be 3 or 4 digits');
    if (number.endsWith('0002')) throw new v.HttpError(402, 'Payment was declined by the card issuer (test card)');
    return { status: 'paid', note: `Card ending ${number.slice(-4)} (simulated gateway)` };
  }
  throw v.badRequest('Unsupported payment method');
}

function orderNumber() {
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `TH${stamp}${crypto.randomInt(0, 1e6).toString().padStart(6, '0')}`;
}

async function loadOrder(where, params) {
  const { rows } = await db.query(
    `SELECT o.*, d.code AS discount_code FROM orders o
       LEFT JOIN discount_codes d ON d.id = o.discount_code_id WHERE ${where}`,
    params,
  );
  const o = rows[0];
  if (!o) return null;
  const [items, history] = await Promise.all([
    db.query(
      `SELECT oi.*, p.slug, (SELECT url FROM product_images i WHERE i.product_id = oi.product_id ORDER BY position, id LIMIT 1) AS image
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.id`,
      [o.id],
    ),
    db.query('SELECT status, note, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC, id DESC', [o.id]),
  ]);
  return orderDto(o, items.rows, history.rows);
}

function orderDto(o, items, history) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    userId: o.user_id,
    email: o.email,
    fullName: o.full_name,
    phone: o.phone,
    shippingAddress: o.shipping_address,
    subtotal: o.subtotal,
    discountCode: o.discount_code || null,
    discountAmount: o.discount_amount,
    tax: o.tax,
    shippingFee: o.shipping_fee,
    pointsUsed: o.points_used,
    pointsDiscount: o.points_discount,
    total: o.total,
    pointsEarned: o.points_earned,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    status: o.status,
    note: o.note,
    createdAt: o.created_at,
    items: items && items.map((i) => ({
      productId: i.product_id,
      variantId: i.variant_id,
      slug: i.slug,
      image: i.image,
      productName: i.product_name,
      variantName: i.variant_name,
      unitPrice: i.unit_price,
      quantity: i.quantity,
      lineTotal: i.line_total,
    })),
    history: history && history.map((h) => ({ status: h.status, note: h.note, at: h.created_at })),
  };
}

router.post('/orders', checkoutLimiter, async (req, res) => {
  const items = parseItems(req.body.items);
  if (!items.length) throw v.badRequest('Your cart is empty');
  const paymentMethod = String(req.body.paymentMethod || '');
  const payment = processPayment(paymentMethod, req.body.payment);
  const s = req.body.shipping || {};
  const note = v.str(req.body.note, { field: 'Order note', max: 300, required: false });

  let setupLink = null;
  const result = await db.tx(async (client) => {
    // 1. Who is buying? Signed-in user, or a guest who gets an account automatically.
    let user;
    let email;
    let accountCreated = false;
    if (req.user) {
      const r = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      user = r.rows[0];
      email = user.email;
    } else {
      email = v.email(s.email);
      const r = await client.query('SELECT * FROM users WHERE email = $1 FOR UPDATE', [email]);
      user = r.rows[0];
      if (user && user.is_banned) throw v.forbidden('This email belongs to a suspended account');
      if (!user) {
        const fullName = v.str(s.fullName ?? s.recipient, { field: 'Full name', min: 2, max: 120 });
        const created = await client.query(
          'INSERT INTO users (email, full_name, phone) VALUES ($1, $2, $3) RETURNING *',
          [email, fullName, v.phone(s.phone, 'Phone', false)],
        );
        user = created.rows[0];
        accountCreated = true;
      }
    }

    // 2. Shipping address: a saved address of the signed-in user, or one typed in.
    let addr;
    if (req.user && s.addressId) {
      const r = await client.query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [v.int(s.addressId, { field: 'addressId', min: 1 }), user.id]);
      if (!r.rows[0]) throw v.badRequest('Selected address was not found');
      addr = r.rows[0];
      if (!addr.phone) addr.phone = v.phone(s.phone, 'Phone');
    } else {
      const a = parseAddress(s, { requirePhone: true });
      addr = { recipient: a.recipient, phone: a.phone, address_line: a.addressLine, ward: a.ward, district: a.district, city: a.city };
      const count = await client.query('SELECT COUNT(*)::int AS n FROM addresses WHERE user_id = $1', [user.id]);
      if ((accountCreated || (req.user && s.saveAddress)) && count.rows[0].n < 10) {
        await insertAddress(client, user.id, a, count.rows[0].n === 0);
      }
    }

    // 3. Re-price everything under row locks so stock and code usage stay consistent.
    const q = await buildQuote(client, {
      items,
      discountCode: req.body.discountCode,
      pointsToUse: req.body.pointsToUse,
      user: req.user ? user : null,
      lock: true,
    });
    const unavailable = q.lines.filter((l) => !l.available);
    if (unavailable.length) {
      throw v.conflict(`Some items changed: ${unavailable.map((l) => `${l.productName || 'item'} - ${l.message}`).join('; ')}`);
    }
    if (req.body.discountCode && !q.discount?.valid) throw v.badRequest(q.discount?.message || 'Invalid discount code');
    const sum = q.summary;

    const number = orderNumber();
    const ins = await client.query(
      `INSERT INTO orders (order_number, user_id, email, full_name, phone, shipping_address, subtotal,
                           discount_code_id, discount_amount, tax, shipping_fee, points_used, points_discount,
                           total, points_earned, payment_method, payment_status, status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending',$18) RETURNING *`,
      [number, user.id, email, addr.recipient, addr.phone, formatAddress(addr), sum.subtotal,
        q.discount?.valid ? q.discountRow.id : null, sum.discountAmount, sum.tax, sum.shippingFee,
        sum.pointsUsed, sum.pointsDiscount, sum.total, sum.pointsEarned, paymentMethod, payment.status,
        [note, payment.note].filter(Boolean).join(' · ')],
    );
    const order = ins.rows[0];

    for (const l of q.lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, category_id,
                                  unit_price, unit_cost, quantity, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, l.productId, l.variantId, l.productName, l.variantName, l.categoryId, l.unitPrice, l.unitCost, l.quantity, l.lineTotal],
      );
      await client.query('UPDATE variants SET stock = stock - $2 WHERE id = $1', [l.variantId, l.quantity]);
      await client.query('UPDATE products SET sold_count = sold_count + $2 WHERE id = $1', [l.productId, l.quantity]);
    }
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note) VALUES ($1, 'pending', $2)`,
      [order.id, payment.status === 'paid' ? 'Order placed and payment received' : 'Order placed, pay on delivery'],
    );
    if (q.discount?.valid) {
      const upd = await client.query(
        'UPDATE discount_codes SET used_count = used_count + 1 WHERE id = $1 AND used_count < usage_limit',
        [q.discountRow.id],
      );
      if (!upd.rowCount) throw v.conflict('This discount code has just reached its usage limit');
    }
    // Points spent now are deducted, points earned are available for the very next order.
    await client.query(
      'UPDATE users SET loyalty_points = loyalty_points - $2 + $3, updated_at = NOW() WHERE id = $1',
      [user.id, sum.pointsUsed, sum.pointsEarned],
    );
    if (accountCreated) setupLink = await createPasswordToken(client, user.id, 'setup');

    return { orderId: order.id, email, accountCreated, productIds: q.lines.map((l) => l.productId) };
  });

  const order = await loadOrder('o.id = $1', [result.orderId]);
  mq.sendEmail(result.email, 'order-confirmation', { order, setupLink, accountCreated: result.accountCreated });
  catalog.publishProductChanges(result.productIds);
  broadcast('admin', 'order:new', { orderNumber: order.orderNumber, total: order.total });
  res.status(201).json({ order, accountCreated: result.accountCreated });
});

// Guests (and anyone without signing in) can track an order with its number and e-mail.
const lookupLimiter = rateLimit({ name: 'lookup', limit: 10, windowSeconds: 300 });
router.post('/orders/lookup', lookupLimiter, async (req, res) => {
  const number = v.str(req.body.orderNumber, { field: 'Order number', min: 6, max: 20 }).toUpperCase();
  const email = v.email(req.body.email);
  const order = await loadOrder('o.order_number = $1 AND lower(o.email) = $2', [number, email]);
  if (!order) throw v.notFound('No order matches this number and e-mail address');
  res.json({ order });
});

router.get('/orders', requireAuth, async (req, res) => {
  const page = v.int(req.query.page, { field: 'page', min: 1, max: 1000, fallback: 1 });
  const limit = 10;
  const [list, count] = await Promise.all([
    db.query(
      `SELECT o.*, d.code AS discount_code FROM orders o LEFT JOIN discount_codes d ON d.id = o.discount_code_id
        WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, (page - 1) * limit],
    ),
    db.query('SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1', [req.user.id]),
  ]);
  const ids = list.rows.map((o) => o.id);
  const items = ids.length
    ? (await db.query('SELECT * FROM order_items WHERE order_id = ANY($1) ORDER BY id', [ids])).rows
    : [];
  res.json({
    items: list.rows.map((o) => orderDto(o, items.filter((i) => i.order_id === o.id), null)),
    total: count.rows[0].n,
    page,
    totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)),
  });
});

router.get('/orders/:number', requireAuth, async (req, res) => {
  const order = await loadOrder('o.order_number = $1', [String(req.params.number)]);
  if (!order || (order.userId !== req.user.id && req.user.role !== 'admin')) throw v.notFound('Order not found');
  res.json({ order });
});

module.exports = { router, loadOrder, orderDto };
