const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const db = require('./db');
const mq = require('./mq');
const { redis, broadcast } = require('./redis');
const { loadUser, requireAdmin } = require('./auth');
const { errorHandler, notFound } = require('./lib/http');
const catalog = require('./lib/catalog');
const { migrateAndSeed } = require('./seed');

const app = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal'); // behind the Nginx gateway
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  // Shows which replica answered; useful to demonstrate load balancing.
  res.set('X-Instance', config.instanceId);
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', instance: config.instanceId, redis: redis.status });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.use('/api', require('./routes/media'));
app.use('/api', loadUser);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/wishlist', require('./routes/wishlist'));
app.use('/api', require('./routes/catalog'));
app.use('/api', require('./routes/reviews'));
app.use('/api', require('./routes/orders').router);

const admin = express.Router();
admin.use(requireAdmin);
admin.use('/dashboard', require('./routes/admin/dashboard'));
admin.use(require('./routes/admin/products'));
admin.use(require('./routes/admin/users'));
admin.use(require('./routes/admin/orders'));
admin.use(require('./routes/admin/discounts'));
app.use('/api/admin', admin);

app.use('/api', (req, _res, next) => next(notFound(`No route for ${req.method} ${req.originalUrl}`)));
app.use(errorHandler);

async function main() {
  await db.waitForDatabase();
  const seeded = await migrateAndSeed();
  await mq.connect();

  // The search service asks for a full snapshot when its index is empty.
  // The queue is shared by all replicas, so exactly one of them answers.
  await mq.consumeEvents('api.catalog-resync', 'catalog.resync.requested', async () => {
    const n = await catalog.publishFullCatalog();
    console.log(`[api] published catalogue snapshot with ${n} products`);
  });
  if (seeded) await catalog.publishFullCatalog();

  // Review sentiment results from the assistant service.
  await mq.consumeEvents('api.comment-sentiment', 'comment.sentiment', async (msg) => {
    const label = ['positive', 'neutral', 'negative'].includes(msg.sentiment) ? msg.sentiment : null;
    if (!label) return;
    const { rows } = await db.query(
      'UPDATE comments SET sentiment = $2, sentiment_score = $3 WHERE id = $1 RETURNING product_id',
      [msg.id, label, Number(msg.score) || 0],
    );
    if (rows[0]) broadcast(`product:${rows[0].product_id}`, 'comment:sentiment', { id: msg.id, sentiment: label });
  });
  // When the assistant starts it asks for comments that were never analysed.
  await mq.consumeEvents('api.sentiment-backfill', 'sentiment.backfill.requested', async () => {
    const { rows } = await db.query('SELECT id, product_id, content FROM comments WHERE sentiment IS NULL ORDER BY id LIMIT 5000');
    for (const r of rows) await mq.publishEvent('comment.created', { id: r.id, productId: r.product_id, content: r.content });
    console.log(`[api] sent ${rows.length} comments for sentiment analysis`);
  });

  const server = app.listen(config.port, () => {
    console.log(`[api] ${config.instanceId} listening on :${config.port}`);
  });
  const shutdown = () => {
    console.log('[api] shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[api] failed to start', err);
    process.exit(1);
  });
}

module.exports = app;
