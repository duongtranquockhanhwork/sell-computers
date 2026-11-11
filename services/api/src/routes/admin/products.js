// Product, category and inventory management from the admin dashboard.
const express = require('express');
const multer = require('multer');
const db = require('../../db');
const mq = require('../../mq');
const v = require('../../lib/http');
const catalog = require('../../lib/catalog');
const { MAX_IMAGES, MAX_IMAGE_BYTES, detectImageType, validateImageList } = require('../../lib/images');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
});

// ---------- Images ----------
// Stores up to 10 illustration images per request in PostgreSQL and returns their URLs.
// The product itself is only changed when the admin saves the product form.
router.post('/uploads', (req, res, next) => {
  upload.array('images', MAX_IMAGES)(req, res, (err) => {
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return next(v.badRequest(`Upload at most ${MAX_IMAGES} images at a time`));
    if (err && err.code === 'LIMIT_FILE_COUNT') return next(v.badRequest(`Upload at most ${MAX_IMAGES} images at a time`));
    return next(err);
  });
}, async (req, res) => {
  if (!req.files || !req.files.length) throw v.badRequest('Choose at least one PNG, JPG, WEBP or GIF image');
  const typed = req.files.map((f) => ({ name: f.originalname, mime: detectImageType(f.buffer), data: f.buffer }));
  const invalid = typed.filter((f) => !f.mime);
  if (invalid.length) {
    throw v.badRequest(`Not a PNG, JPG, WEBP or GIF image: ${invalid.map((f) => f.name).join(', ')}`);
  }
  const urls = await db.tx(async (client) => {
    const out = [];
    for (const f of typed) {
      const { rows } = await client.query('INSERT INTO media (mime, data) VALUES ($1, $2) RETURNING id', [f.mime, f.data]);
      out.push(`/api/media/${rows[0].id}`);
    }
    return out;
  });
  res.status(201).json({ urls });
});

// ---------- Categories ----------
router.get('/categories', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, COUNT(p.id)::int AS product_count FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.position, c.name`,
  );
  res.json({ categories: rows });
});

function parseCategory(body) {
  const name = v.str(body.name, { field: 'Category name', min: 2, max: 80 });
  return {
    name,
    slug: v.slugify(body.slug || name),
    description: v.str(body.description, { field: 'Description', max: 500, required: false }),
    icon: v.str(body.icon, { field: 'Icon', max: 30, required: false }) || 'box',
    position: v.int(body.position, { field: 'Position', min: 0, max: 999, fallback: 0 }),
  };
}

router.post('/categories', async (req, res) => {
  const c = parseCategory(req.body);
  const { rows } = await db.query(
    'INSERT INTO categories (name, slug, description, icon, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [c.name, c.slug, c.description, c.icon, c.position],
  );
  res.status(201).json({ category: rows[0] });
});

router.put('/categories/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const c = parseCategory(req.body);
  const { rows } = await db.query(
    'UPDATE categories SET name=$2, slug=$3, description=$4, icon=$5, position=$6 WHERE id=$1 RETURNING *',
    [id, c.name, c.slug, c.description, c.icon, c.position],
  );
  if (!rows.length) throw v.notFound('Category not found');
  const ids = await db.query('SELECT id FROM products WHERE category_id = $1', [id]);
  catalog.publishProductChanges(ids.rows.map((r) => r.id));
  res.json({ category: rows[0] });
});

router.delete('/categories/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const used = await db.query('SELECT COUNT(*)::int AS n FROM products WHERE category_id = $1', [id]);
  if (used.rows[0].n) throw v.conflict('Move or delete the products in this category first');
  const r = await db.query('DELETE FROM categories WHERE id = $1', [id]);
  if (!r.rowCount) throw v.notFound('Category not found');
  res.json({ ok: true });
});

// ---------- Products ----------
router.get('/products', async (req, res) => {
  const page = v.int(req.query.page, { field: 'page', min: 1, fallback: 1 });
  const limit = 20;
  const params = [];
  const where = [];
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.brand ILIKE $${params.length} OR EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.sku ILIKE $${params.length}))`);
  }
  if (req.query.category) {
    params.push(Number(req.query.category));
    where.push(`p.category_id = $${params.length}`);
  }
  if (req.query.lowStock === 'true') where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.stock <= 5)');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [list, count] = await Promise.all([
    db.query(
      `SELECT p.id, p.name, p.slug, p.brand, p.min_price, p.sold_count, p.is_active, p.created_at, c.name AS category,
              (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position, id LIMIT 1) AS image,
              (SELECT COALESCE(SUM(stock),0) FROM variants v WHERE v.product_id = p.id)::int AS stock,
              (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id)::int AS variant_count
         FROM products p JOIN categories c ON c.id = p.category_id ${w}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM products p ${w}`, params),
  ]);
  res.json({ items: list.rows, total: count.rows[0].n, page, totalPages: Math.max(1, Math.ceil(count.rows[0].n / limit)) });
});

router.get('/products/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  if (!rows.length) throw v.notFound('Product not found');
  const [variants, images] = await Promise.all([
    db.query('SELECT * FROM variants WHERE product_id = $1 ORDER BY position, id', [id]),
    db.query('SELECT url FROM product_images WHERE product_id = $1 ORDER BY position, id', [id]),
  ]);
  res.json({ product: { ...rows[0], variants: variants.rows, images: images.rows.map((r) => r.url) } });
});

function parseProduct(body) {
  const name = v.str(body.name, { field: 'Product name', min: 3, max: 200 });
  const description = v.str(body.description, { field: 'Description', min: 20, max: 10000 });
  const { images, error: imageError } = validateImageList(body.images ?? []);
  if (imageError) throw v.badRequest(imageError);
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!variants.length) throw v.badRequest('A product needs at least one variant');
  let specs = {};
  if (body.specs && typeof body.specs === 'object' && !Array.isArray(body.specs)) {
    specs = Object.fromEntries(Object.entries(body.specs).slice(0, 30).map(([k, val]) => [String(k).slice(0, 60), String(val).slice(0, 200)]));
  }
  return {
    name,
    slug: v.slugify(body.slug || name),
    brand: v.str(body.brand, { field: 'Brand', min: 1, max: 60 }),
    categoryId: v.int(body.categoryId, { field: 'Category', min: 1 }),
    shortDescription: v.str(body.shortDescription, { field: 'Short description', min: 10, max: 300 }),
    description,
    specs,
    tags: Array.isArray(body.tags) ? [...new Set(body.tags.map((t) => v.slugify(t)).filter(Boolean))].slice(0, 15) : [],
    isActive: body.isActive !== false,
    images,
    variants: variants.slice(0, 20).map((x, i) => ({
      id: x.id ? v.int(x.id, { field: 'variant id', min: 1 }) : null,
      sku: v.str(x.sku, { field: `Variant ${i + 1} SKU`, min: 2, max: 60 }).toUpperCase(),
      name: v.str(x.name, { field: `Variant ${i + 1} name`, min: 1, max: 120 }),
      price: v.int(x.price, { field: `Variant ${i + 1} price`, min: 1000, max: 2e9 }),
      compareAtPrice: (x.compareAtPrice ?? x.compare_at_price) ? v.int(x.compareAtPrice ?? x.compare_at_price, { field: `Variant ${i + 1} original price`, min: 1000, max: 2e9 }) : null,
      costPrice: v.int(x.costPrice ?? x.cost_price, { field: `Variant ${i + 1} cost price`, min: 0, max: 2e9 }),
      stock: v.int(x.stock, { field: `Variant ${i + 1} stock`, min: 0, max: 100000 }),
      isActive: x.isActive !== false && x.is_active !== false,
      position: i,
    })),
  };
}

function checkVariantPrices(p) {
  const bad = p.variants.find((x) => x.compareAtPrice !== null && x.compareAtPrice <= x.price);
  if (bad) throw v.badRequest(`Variant ${bad.sku}: the original price must be higher than the selling price`);
  return p;
}

async function saveVariantsAndImages(client, productId, p) {
  const keep = p.variants.filter((x) => x.id).map((x) => x.id);
  await client.query('DELETE FROM variants WHERE product_id = $1 AND NOT (id = ANY($2))', [productId, keep]);
  for (const x of p.variants) {
    if (x.id) {
      const r = await client.query(
        `UPDATE variants SET sku=$3, name=$4, price=$5, cost_price=$6, stock=$7, is_active=$8, position=$9, compare_at_price=$10
          WHERE id=$1 AND product_id=$2`,
        [x.id, productId, x.sku, x.name, x.price, x.costPrice, x.stock, x.isActive, x.position, x.compareAtPrice],
      );
      if (!r.rowCount) throw v.badRequest(`Variant ${x.sku} does not belong to this product`);
    } else {
      await client.query(
        `INSERT INTO variants (product_id, sku, name, price, cost_price, stock, is_active, position, compare_at_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [productId, x.sku, x.name, x.price, x.costPrice, x.stock, x.isActive, x.position, x.compareAtPrice],
      );
    }
  }
  await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  for (const [i, url] of p.images.entries()) {
    await client.query('INSERT INTO product_images (product_id, url, position) VALUES ($1,$2,$3)', [productId, url, i]);
  }
  await catalog.refreshProductAggregates(client, productId);
}

router.post('/products', async (req, res) => {
  const p = checkVariantPrices(parseProduct(req.body));
  const id = await db.tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO products (name, slug, brand, category_id, short_description, description, specs, tags, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.name, p.slug, p.brand, p.categoryId, p.shortDescription, p.description, p.specs, p.tags, p.isActive],
    );
    await saveVariantsAndImages(client, rows[0].id, p);
    return rows[0].id;
  });
  catalog.publishProductChanges([id]);
  res.status(201).json({ id });
});

router.put('/products/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const p = checkVariantPrices(parseProduct(req.body));
  await db.tx(async (client) => {
    const r = await client.query(
      `UPDATE products SET name=$2, slug=$3, brand=$4, category_id=$5, short_description=$6, description=$7,
              specs=$8, tags=$9, is_active=$10, updated_at=NOW() WHERE id=$1`,
      [id, p.name, p.slug, p.brand, p.categoryId, p.shortDescription, p.description, p.specs, p.tags, p.isActive],
    );
    if (!r.rowCount) throw v.notFound('Product not found');
    await saveVariantsAndImages(client, id, p);
  });
  catalog.publishProductChanges([id]);
  res.json({ id });
});

router.delete('/products/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  // Order lines keep a copy of the product name and price, so history survives deletion.
  const r = await db.query('DELETE FROM products WHERE id = $1', [id]);
  if (!r.rowCount) throw v.notFound('Product not found');
  mq.publishEvent('product.deleted', { id });
  res.json({ ok: true });
});

// Quick inventory adjustment for a single variant.
router.patch('/variants/:id/stock', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const stock = v.int(req.body.stock, { field: 'Stock', min: 0, max: 100000 });
  const { rows } = await db.query('UPDATE variants SET stock = $2 WHERE id = $1 RETURNING product_id, stock', [id, stock]);
  if (!rows.length) throw v.notFound('Variant not found');
  catalog.publishProductChanges([rows[0].product_id]);
  res.json({ stock: rows[0].stock });
});

module.exports = router;
