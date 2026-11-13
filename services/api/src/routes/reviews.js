// Comments (anyone) and star ratings (signed-in users). New entries are pushed to
// every open product page through Redis -> realtime service -> Socket.IO.
const express = require('express');
const db = require('../db');
const v = require('../lib/http');
const { requireAuth } = require('../auth');
const { broadcast, rateLimit } = require('../redis');
const catalog = require('../lib/catalog');
const mq = require('../mq');

const router = express.Router();
const commentLimiter = rateLimit({ name: 'comment', limit: 5, windowSeconds: 60 });

async function productId(slugOrId) {
  const { rows } = await db.query('SELECT id FROM products WHERE (slug = $1 OR id::text = $1) AND is_active', [String(slugOrId)]);
  if (!rows.length) throw v.notFound('Product not found');
  return rows[0].id;
}

function commentDto(r) {
  return {
    id: r.id,
    authorName: r.author_name,
    content: r.content,
    createdAt: r.created_at,
    isMember: Boolean(r.user_id),
    stars: r.stars ?? null,
    sentiment: r.sentiment ?? null,
  };
}

router.get('/products/:id/comments', async (req, res) => {
  const id = await productId(req.params.id);
  const page = v.int(req.query.page, { field: 'page', min: 1, max: 1000, fallback: 1 });
  const limit = 10;
  const [list, count] = await Promise.all([
    db.query(
      `SELECT cm.*, r.stars FROM comments cm
         LEFT JOIN ratings r ON r.product_id = cm.product_id AND r.user_id = cm.user_id
        WHERE cm.product_id = $1 ORDER BY cm.created_at DESC, cm.id DESC LIMIT $2 OFFSET $3`,
      [id, limit, (page - 1) * limit],
    ),
    db.query('SELECT COUNT(*)::int AS n FROM comments WHERE product_id = $1', [id]),
  ]);
  res.json({
    items: list.rows.map(commentDto),
    total: count.rows[0].n,
    page,
    totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)),
  });
});

router.post('/products/:id/comments', commentLimiter, async (req, res) => {
  const id = await productId(req.params.id);
  const content = v.str(req.body.content, { field: 'Comment', min: 2, max: 2000 });
  const authorName = req.user
    ? req.user.full_name
    : v.str(req.body.authorName, { field: 'Your name', min: 2, max: 80 });
  const { rows } = await db.query(
    `INSERT INTO comments (product_id, user_id, author_name, content) VALUES ($1, $2, $3, $4)
     RETURNING *, (SELECT stars FROM ratings WHERE product_id = $1 AND user_id = $2) AS stars`,
    [id, req.user?.id ?? null, authorName, content],
  );
  const comment = commentDto(rows[0]);
  broadcast(`product:${id}`, 'comment:new', comment);
  // The assistant service classifies the comment and answers with comment.sentiment.
  mq.publishEvent('comment.created', { id: comment.id, productId: id, content });
  res.status(201).json({ comment });
});

router.put('/products/:id/rating', requireAuth, async (req, res) => {
  const id = await productId(req.params.id);
  const stars = v.int(req.body.stars, { field: 'Stars', min: 1, max: 5 });
  const summary = await db.tx(async (client) => {
    await client.query(
      `INSERT INTO ratings (product_id, user_id, stars) VALUES ($1, $2, $3)
       ON CONFLICT (product_id, user_id) DO UPDATE SET stars = EXCLUDED.stars, updated_at = NOW()`,
      [id, req.user.id, stars],
    );
    const agg = await client.query(
      `UPDATE products SET
         avg_rating = COALESCE((SELECT ROUND(AVG(stars)::numeric, 2) FROM ratings WHERE product_id = $1), 0),
         rating_count = (SELECT COUNT(*) FROM ratings WHERE product_id = $1)
       WHERE id = $1 RETURNING avg_rating, rating_count`,
      [id],
    );
    const dist = await client.query('SELECT stars, COUNT(*)::int AS n FROM ratings WHERE product_id = $1 GROUP BY stars', [id]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of dist.rows) distribution[r.stars] = r.n;
    return { average: Number(agg.rows[0].avg_rating), count: agg.rows[0].rating_count, distribution };
  });
  broadcast(`product:${id}`, 'rating:updated', summary);
  catalog.publishProductChanges([id]);
  res.json({ rating: { ...summary, mine: stars } });
});

module.exports = router;
