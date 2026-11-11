// Search service: owns the ElasticSearch index.
//  - Indexer: consumes product events from RabbitMQ and keeps the index in sync.
//  - Query API: GET /search and GET /suggest, called by the API service.
const express = require('express');
const amqp = require('amqplib');
const { Client } = require('@elastic/elasticsearch');

const PORT = Number(process.env.PORT || 4100);
const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const AMQP_URL = process.env.AMQP_URL || 'amqp://techhaven:techhaven@localhost:5672';
const INDEX = 'products';
const EXCHANGE = 'techhaven.events';
const QUEUE = 'search.index';

const es = new Client({ node: ES_URL, requestTimeout: 5000 });
let ready = false;

const MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        folded: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
      },
    },
  },
  mappings: {
    properties: {
      name: { type: 'text', analyzer: 'folded', fields: { keyword: { type: 'keyword' }, suggest: { type: 'search_as_you_type', analyzer: 'folded' } } },
      slug: { type: 'keyword' },
      brand: { type: 'keyword', fields: { text: { type: 'text', analyzer: 'folded' } } },
      category: { type: 'keyword' },
      categoryName: { type: 'text', analyzer: 'folded' },
      shortDescription: { type: 'text', analyzer: 'folded' },
      description: { type: 'text', analyzer: 'folded' },
      variants: { type: 'text', analyzer: 'folded' },
      tags: { type: 'keyword', fields: { text: { type: 'text', analyzer: 'folded' } } },
      price: { type: 'long' },
      avgRating: { type: 'float' },
      ratingCount: { type: 'integer' },
      soldCount: { type: 'integer' },
      inStock: { type: 'boolean' },
      onSale: { type: 'boolean' },
      discountPercent: { type: 'integer' },
      createdAt: { type: 'date' },
      isActive: { type: 'boolean' },
    },
  },
};

async function waitForElastic() {
  for (let i = 1; ; i++) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (err) {
      console.log(`[search] waiting for ElasticSearch (${i}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function ensureIndex() {
  const exists = await es.indices.exists({ index: INDEX });
  if (!exists) {
    await es.indices.create({ index: INDEX, ...MAPPING });
    console.log('[search] index created');
  }
  const { count } = await es.count({ index: INDEX });
  return count;
}

function toDoc(p) {
  return { ...p, inStock: p.inStock !== false };
}

async function handleEvent(routingKey, body) {
  if (routingKey === 'product.upserted') {
    await es.index({ index: INDEX, id: String(body.id), document: toDoc(body) });
  } else if (routingKey === 'product.deleted') {
    await es.delete({ index: INDEX, id: String(body.id) }, { ignore: [404] });
  } else if (routingKey === 'catalog.snapshot') {
    const ops = body.products.flatMap((p) => [{ index: { _index: INDEX, _id: String(p.id) } }, toDoc(p)]);
    if (ops.length) await es.bulk({ refresh: true, operations: ops });
    console.log(`[search] indexed snapshot of ${body.products.length} products`);
  }
}

async function startConsumer(initialCount) {
  for (;;) {
    try {
      const conn = await amqp.connect(AMQP_URL);
      const ch = await conn.createChannel();
      await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
      await ch.assertQueue(QUEUE, { durable: true });
      await ch.bindQueue(QUEUE, EXCHANGE, 'product.*');
      await ch.bindQueue(QUEUE, EXCHANGE, 'catalog.snapshot');
      await ch.prefetch(10);
      await ch.consume(QUEUE, async (msg) => {
        if (!msg) return;
        try {
          await handleEvent(msg.fields.routingKey, JSON.parse(msg.content.toString()));
          ch.ack(msg);
        } catch (err) {
          console.error('[search] indexing failed, will retry', err.message);
          setTimeout(() => ch.nack(msg, false, true), 3000);
        }
      });
      // Empty index (first start, or ElasticSearch volume lost): ask the API for a snapshot.
      if (initialCount === 0) {
        ch.publish(EXCHANGE, 'catalog.resync.requested', Buffer.from('{}'), { persistent: true });
        console.log('[search] index empty, requested catalogue snapshot');
        initialCount = -1;
      }
      ready = true;
      console.log('[search] consuming product events');
      await new Promise((resolve) => conn.on('close', resolve));
      ready = false;
    } catch (err) {
      console.log(`[search] waiting for RabbitMQ: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const SORTS = {
  relevance: ['_score', { soldCount: 'desc' }],
  newest: [{ createdAt: 'desc' }],
  name_asc: [{ 'name.keyword': 'asc' }],
  name_desc: [{ 'name.keyword': 'desc' }],
  price_asc: [{ price: 'asc' }],
  price_desc: [{ price: 'desc' }],
  best_selling: [{ soldCount: 'desc' }],
  rating: [{ avgRating: 'desc' }, { ratingCount: 'desc' }],
  discount: [{ discountPercent: 'desc' }, { soldCount: 'desc' }],
};

const app = express();

app.get('/health', (req, res) => res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'starting' }));

app.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
  const filter = [{ term: { isActive: true } }];
  if (req.query.category) filter.push({ term: { category: String(req.query.category) } });
  if (req.query.brand) filter.push({ terms: { brand: String(req.query.brand).split(',') } });
  if (req.query.tag) filter.push({ term: { tags: String(req.query.tag) } });
  if (req.query.inStock === 'true') filter.push({ term: { inStock: true } });
  if (req.query.onSale === 'true') filter.push({ term: { onSale: true } });
  const price = {};
  if (req.query.minPrice) price.gte = Number(req.query.minPrice);
  if (req.query.maxPrice) price.lte = Number(req.query.maxPrice);
  if (Object.keys(price).length) filter.push({ range: { price } });
  if (req.query.minRating) filter.push({ range: { avgRating: { gte: Number(req.query.minRating) } } });

  // Exact matches across all text fields score highest; a typo-tolerant match on
  // names and brands catches misspellings ("samsng"). Short tokens such as model
  // numbers ("4070") are never fuzzed, so they do not match neighbouring models.
  const must = q
    ? [{
      bool: {
        should: [
          {
            multi_match: {
              query: q,
              fields: ['name^4', 'name.suggest^2', 'brand.text^3', 'categoryName^2', 'tags.text^2', 'variants', 'shortDescription', 'description^0.5'],
              operator: 'and',
              boost: 3,
            },
          },
          { multi_match: { query: q, fields: ['name^2', 'brand.text^2', 'categoryName'], fuzziness: 'AUTO:5,8', operator: 'and' } },
        ],
        minimum_should_match: 1,
      },
    }]
    : [{ match_all: {} }];
  try {
    const r = await es.search({
      index: INDEX,
      from: (page - 1) * limit,
      size: limit,
      query: { bool: { must, filter } },
      sort: SORTS[req.query.sort] || SORTS.relevance,
      track_total_hits: true,
      _source: false,
    });
    res.json({ ids: r.hits.hits.map((h) => Number(h._id)), total: r.hits.total.value, took: r.took });
  } catch (err) {
    console.error('[search] query failed', err.message);
    res.status(503).json({ error: 'search unavailable' });
  }
});

app.get('/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ suggestions: [] });
  try {
    const r = await es.search({
      index: INDEX,
      size: 6,
      query: {
        bool: {
          must: [{ multi_match: { query: q, type: 'bool_prefix', fields: ['name.suggest', 'name.suggest._2gram', 'name.suggest._3gram', 'brand.text'] } }],
          filter: [{ term: { isActive: true } }],
        },
      },
      _source: ['name', 'slug', 'price'],
    });
    res.json({ suggestions: r.hits.hits.map((h) => h._source) });
  } catch (err) {
    res.status(503).json({ error: 'search unavailable' });
  }
});

async function main() {
  app.listen(PORT, () => console.log(`[search] listening on :${PORT}`));
  await waitForElastic();
  const count = await ensureIndex();
  console.log(`[search] index "${INDEX}" has ${count} documents`);
  startConsumer(count);
}

main().catch((err) => {
  console.error('[search] fatal', err);
  process.exit(1);
});
