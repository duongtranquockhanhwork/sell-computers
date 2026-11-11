// Wish list of signed-in customers. Guests keep theirs in the browser and it is
// merged into the account at sign-in (POST /wishlist/merge).
const express = require('express');
const db = require('../db');
const v = require('../lib/http');
const catalog = require('../lib/catalog');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const MAX_ITEMS = 100;

async function productIds(userId) {
  const { rows } = await db.query('SELECT product_id FROM wishlists WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return rows.map((r) => r.product_id);
}

router.get('/', async (req, res) => {
  const page = v.int(req.query.page, { field: 'page', min: 1, max: 100, fallback: 1 });
  const limit = v.int(req.query.limit, { field: 'limit', min: 1, max: 48, fallback: 12 });
  const ids = await productIds(req.user.id);
  const items = await catalog.cardsByIds(ids.slice((page - 1) * limit, page * limit));
  res.json({ ids, items, total: ids.length, page, totalPages: Math.max(1, Math.ceil(ids.length / limit)) });
});

router.put('/:productId', async (req, res) => {
  const id = v.int(req.params.productId, { field: 'productId', min: 1 });
  const count = await db.query('SELECT COUNT(*)::int AS n FROM wishlists WHERE user_id = $1', [req.user.id]);
  if (count.rows[0].n >= MAX_ITEMS) throw v.badRequest(`Your wish list can hold up to ${MAX_ITEMS} products`);
  const r = await db.query(
    `INSERT INTO wishlists (user_id, product_id) SELECT $1, id FROM products WHERE id = $2 AND is_active
     ON CONFLICT DO NOTHING`,
    [req.user.id, id],
  );
  const exists = await db.query('SELECT 1 FROM products WHERE id = $1 AND is_active', [id]);
  if (!exists.rowCount) throw v.notFound('Product not found');
  res.status(r.rowCount ? 201 : 200).json({ ids: await productIds(req.user.id) });
});

router.delete('/:productId', async (req, res) => {
  const id = v.int(req.params.productId, { field: 'productId', min: 1 });
  await db.query('DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2', [req.user.id, id]);
  res.json({ ids: await productIds(req.user.id) });
});

router.post('/merge', async (req, res) => {
  const ids = Array.isArray(req.body.productIds) ? req.body.productIds.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, MAX_ITEMS) : [];
  if (ids.length) {
    await db.query(
      `INSERT INTO wishlists (user_id, product_id) SELECT $1, id FROM products WHERE id = ANY($2) AND is_active
       ON CONFLICT DO NOTHING`,
      [req.user.id, ids],
    );
  }
  res.json({ ids: await productIds(req.user.id) });
});

module.exports = router;
