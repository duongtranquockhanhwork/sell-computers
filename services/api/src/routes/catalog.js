const express = require('express');
const config = require('../config');
const db = require('../db');
const v = require('../lib/http');
const catalog = require('../lib/catalog');
const images = require('../lib/images');

const router = express.Router();

// Categories shown as dedicated sections on the landing page.
const HOME_SECTIONS = ['laptops', 'desktop-pcs', 'monitors', 'graphics-cards', 'storage'];

router.get('/config', (req, res) => {
  res.json({
    googleEnabled: config.google.enabled,
    instance: config.instanceId,
    productImages: { min: images.MIN_IMAGES, max: images.MAX_IMAGES, maxBytes: images.MAX_IMAGE_BYTES },
  });
});

router.get('/categories', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.slug, c.description, c.icon,
            COUNT(p.id) FILTER (WHERE p.is_active)::int AS product_count
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.position, c.name`,
  );
  res.json({
    categories: rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, description: r.description, icon: r.icon, productCount: r.product_count,
    })),
  });
});

router.get('/brands', async (req, res) => {
  const params = [];
  let where = 'p.is_active';
  if (req.query.category) {
    params.push(String(req.query.category));
    where += ' AND c.slug = $1';
  }
  const { rows } = await db.query(
    `SELECT p.brand, COUNT(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id
      WHERE ${where} GROUP BY p.brand ORDER BY p.brand`,
    params,
  );
  res.json({ brands: rows.map((r) => ({ name: r.brand, count: r.n })) });
});

router.get('/tags', async (req, res) => {
  const { rows } = await db.query(
    `SELECT t AS tag, COUNT(*)::int AS n FROM products p, unnest(p.tags) t
      WHERE p.is_active GROUP BY t ORDER BY n DESC, t LIMIT 30`,
  );
  res.json({ tags: rows.map((r) => ({ name: r.tag, count: r.n })) });
});

router.get('/home', async (req, res) => {
  const [newest, best] = await Promise.all([
    catalog.listCards({}, { sort: 'newest', limit: 8 }),
    catalog.listCards({}, { sort: 'best_selling', limit: 8 }),
  ]);
  const cats = await db.query('SELECT name, slug, description, icon FROM categories WHERE slug = ANY($1)', [HOME_SECTIONS]);
  const sections = await Promise.all(
    HOME_SECTIONS.map(async (slug) => {
      const c = cats.rows.find((r) => r.slug === slug);
      if (!c) return null;
      const { items } = await catalog.listCards({ category: slug }, { sort: 'best_selling', limit: 4 });
      return { category: c, products: items };
    }),
  );
  res.json({ newProducts: newest.items, bestSellers: best.items, sections: sections.filter(Boolean) });
});

function parseListQuery(q) {
  const num = (x) => (x === undefined || x === '' ? null : Math.max(0, Math.floor(Number(x)) || 0));
  return {
    q: q.q ? String(q.q).trim().slice(0, 100) : '',
    category: q.category ? String(q.category) : null,
    brands: q.brand ? String(q.brand).split(',').map((b) => b.trim()).filter(Boolean).slice(0, 20) : [],
    minPrice: num(q.minPrice),
    maxPrice: num(q.maxPrice),
    minRating: q.minRating ? Math.min(5, Math.max(0, Number(q.minRating) || 0)) : null,
    tag: q.tag ? String(q.tag).slice(0, 40) : null,
    inStock: q.inStock === 'true',
    onSale: q.onSale === 'true',
    sort: String(q.sort || (q.q ? 'relevance' : 'newest')),
    page: v.int(q.page, { field: 'page', min: 1, max: 10000, fallback: 1 }),
    limit: v.int(q.limit, { field: 'limit', min: 1, max: 48, fallback: 12 }),
  };
}

// Full-text search runs in ElasticSearch (search service). If the service is
// unreachable the API degrades to a PostgreSQL ILIKE query instead of failing.
async function searchViaElastic(f) {
  const params = new URLSearchParams({ q: f.q, sort: f.sort, page: f.page, limit: f.limit });
  if (f.category) params.set('category', f.category);
  if (f.brands.length) params.set('brand', f.brands.join(','));
  if (f.minPrice != null) params.set('minPrice', f.minPrice);
  if (f.maxPrice != null) params.set('maxPrice', f.maxPrice);
  if (f.minRating != null) params.set('minRating', f.minRating);
  if (f.tag) params.set('tag', f.tag);
  if (f.inStock) params.set('inStock', 'true');
  if (f.onSale) params.set('onSale', 'true');
  const r = await fetch(`${config.searchUrl}/search?${params}`, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`search service answered ${r.status}`);
  return r.json();
}

router.get('/products', async (req, res) => {
  const f = parseListQuery(req.query);
  let total;
  let items;
  let engine = 'postgres';
  if (f.q) {
    try {
      const result = await searchViaElastic(f);
      items = await catalog.cardsByIds(result.ids);
      total = result.total;
      engine = 'elasticsearch';
    } catch (err) {
      console.warn('[catalog] search service unavailable, using SQL fallback:', err.message);
    }
  }
  if (!items) {
    const sort = f.sort === 'relevance' ? 'best_selling' : f.sort;
    ({ total, items } = await catalog.listCards(f, { sort, limit: f.limit, offset: (f.page - 1) * f.limit }));
  }
  res.json({
    items,
    total,
    page: f.page,
    limit: f.limit,
    totalPages: Math.max(1, Math.ceil(total / f.limit)),
    engine,
  });
});

router.get('/search/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ suggestions: [] });
  try {
    const r = await fetch(`${config.searchUrl}/suggest?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error(String(r.status));
    return res.json(await r.json());
  } catch {
    const { rows } = await db.query(
      `SELECT name, slug FROM products WHERE is_active AND name ILIKE $1 ORDER BY sold_count DESC LIMIT 6`,
      [`%${q}%`],
    );
    return res.json({ suggestions: rows });
  }
});

// Cards for a list of slugs kept in the browser (compare, recently viewed, guest wish list).
router.get('/products/by-slugs', async (req, res) => {
  const slugs = String(req.query.slugs || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 48);
  res.json({ items: await catalog.cardsBySlugs(slugs) });
});

router.get('/products/:slug', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.slug = $1 AND p.is_active`,
    [req.params.slug],
  );
  const p = rows[0];
  if (!p) throw v.notFound('Product not found');

  const [variants, images, dist, related, myRating] = await Promise.all([
    db.query('SELECT id, sku, name, price, compare_at_price, stock FROM variants WHERE product_id = $1 AND is_active ORDER BY position, id', [p.id]),
    db.query('SELECT url FROM product_images WHERE product_id = $1 ORDER BY position, id', [p.id]),
    db.query('SELECT stars, COUNT(*)::int AS n FROM ratings WHERE product_id = $1 GROUP BY stars', [p.id]),
    catalog.listCards({ category: p.category_slug }, { sort: 'best_selling', limit: 5 }),
    req.user ? db.query('SELECT stars FROM ratings WHERE product_id = $1 AND user_id = $2', [p.id, req.user.id]) : { rows: [] },
  ]);
  const sentiment = await sentimentSummary(p.id);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of dist.rows) distribution[r.stars] = r.n;

  res.json({
    product: {
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      shortDescription: p.short_description,
      description: p.description,
      specs: p.specs,
      tags: p.tags,
      price: p.min_price,
      soldCount: p.sold_count,
      category: { name: p.category_name, slug: p.category_slug },
      images: images.rows.map((r) => r.url),
      variants: variants.rows.map((r) => ({
        id: r.id, sku: r.sku, name: r.name, price: r.price, stock: r.stock,
        compareAtPrice: r.compare_at_price > r.price ? r.compare_at_price : null,
        discountPercent: catalog.discountPercent(Number(r.price), Number(r.compare_at_price)),
      })),
      sentiment,
      rating: { average: Number(p.avg_rating), count: p.rating_count, distribution, mine: myRating.rows[0]?.stars ?? null },
    },
    related: related.items.filter((r) => r.id !== p.id).slice(0, 4),
  });
});

// Share of positive / neutral / negative comments (computed by the assistant service).
async function sentimentSummary(productId) {
  const { rows } = await db.query(
    `SELECT sentiment, COUNT(*)::int AS n FROM comments WHERE product_id = $1 AND sentiment IS NOT NULL GROUP BY sentiment`,
    [productId],
  );
  const out = { positive: 0, neutral: 0, negative: 0 };
  for (const r of rows) out[r.sentiment] = r.n;
  return { ...out, analysed: out.positive + out.neutral + out.negative };
}

// ---------- SEO: robots.txt and sitemap.xml (served at the site root by the gateway) ----------
router.get('/seo/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /account
Disallow: /checkout
Sitemap: ${config.publicUrl}/sitemap.xml
`);
});

router.get('/seo/sitemap.xml', async (req, res) => {
  const [products, cats, tags] = await Promise.all([
    db.query('SELECT slug, updated_at FROM products WHERE is_active ORDER BY id'),
    db.query('SELECT slug FROM categories ORDER BY position'),
    db.query('SELECT DISTINCT unnest(tags) AS t FROM products WHERE is_active ORDER BY 1'),
  ]);
  const u = (loc, extra = '') => `<url><loc>${config.publicUrl}${loc}</loc>${extra}</url>`;
  const urls = [u('/'), u('/products'),
    ...cats.rows.map((c) => u(`/category/${c.slug}`)),
    ...tags.rows.map((t) => u(`/products?tag=${encodeURIComponent(t.t)}`)),
    ...products.rows.map((p) => u(`/products/${p.slug}`, `<lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod>`))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

module.exports = router;
