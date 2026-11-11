// Read models for products: cards (lists), details, and search documents.
const db = require('../db');
const mq = require('../mq');

const CARD_SELECT = `
  SELECT p.id, p.name, p.slug, p.brand, p.short_description, p.min_price, p.min_compare_price, p.sold_count,
         p.avg_rating, p.rating_count, p.created_at, p.tags, p.specs,
         c.name AS category_name, c.slug AS category_slug,
         (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position, id LIMIT 1) AS image,
         (SELECT COALESCE(SUM(stock), 0) FROM variants v WHERE v.product_id = p.id AND v.is_active) AS stock,
         (SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id AND v.is_active) AS variant_count
    FROM products p
    JOIN categories c ON c.id = p.category_id`;

const NEW_PRODUCT_DAYS = 45;

function discountPercent(price, compareAt) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

// Up to three short specification values shown as chips on product cards,
// chosen in the order shoppers compare them (like the spec chips of real PC stores).
const SPEC_PRIORITY = ['Processor', 'GPU', 'Graphics', 'Memory', 'Storage', 'Display', 'Size', 'Resolution',
  'Refresh rate', 'Panel', 'Cores', 'Boost clock', 'Socket', 'Chipset', 'Form factor', 'Type', 'Speed',
  'Read speed', 'Interface', 'Efficiency', 'Modular', 'Warranty'];
function keySpecs(specs) {
  const s = specs || {};
  const keys = [...SPEC_PRIORITY.filter((k) => k in s), ...Object.keys(s).filter((k) => !SPEC_PRIORITY.includes(k))];
  return keys.map((k) => String(s[k]).replace(/^(Intel|AMD|NVIDIA GeForce|AMD Radeon) /, ''))
    .filter((x) => x.length <= 24).slice(0, 3);
}

function cardDto(r) {
  const off = discountPercent(Number(r.min_price), Number(r.min_compare_price));
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    brand: r.brand,
    shortDescription: r.short_description,
    price: r.min_price,
    compareAtPrice: off ? r.min_compare_price : null,
    discountPercent: off,
    keySpecs: keySpecs(r.specs),
    tags: r.tags,
    soldCount: r.sold_count,
    avgRating: Number(r.avg_rating),
    ratingCount: r.rating_count,
    image: r.image,
    inStock: r.stock > 0,
    variantCount: r.variant_count,
    isNew: Date.now() - new Date(r.created_at).getTime() < NEW_PRODUCT_DAYS * 86400000,
    category: { name: r.category_name, slug: r.category_slug },
  };
}

const SORTS = {
  newest: 'p.created_at DESC, p.id DESC',
  name_asc: 'p.name ASC, p.id ASC',
  name_desc: 'p.name DESC, p.id DESC',
  price_asc: 'p.min_price ASC, p.id ASC',
  price_desc: 'p.min_price DESC, p.id DESC',
  best_selling: 'p.sold_count DESC, p.id DESC',
  rating: 'p.avg_rating DESC, p.rating_count DESC, p.id DESC',
  discount: `(CASE WHEN p.min_compare_price > p.min_price
                  THEN (p.min_compare_price - p.min_price)::float / p.min_compare_price ELSE 0 END) DESC, p.id DESC`,
};

// Builds a WHERE clause from catalogue filters. Returns { where, params }.
function buildFilters(f) {
  const params = [];
  const clauses = ['p.is_active'];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (f.category) add('c.slug = ?', f.category);
  if (f.brands && f.brands.length) add('p.brand = ANY(?)', f.brands);
  if (f.minPrice != null) add('p.min_price >= ?', f.minPrice);
  if (f.maxPrice != null) add('p.min_price <= ?', f.maxPrice);
  if (f.minRating != null) add('p.avg_rating >= ?', f.minRating);
  if (f.tag) add('? = ANY(p.tags)', f.tag);
  if (f.onSale) clauses.push('p.min_compare_price > p.min_price');
  if (f.inStock) clauses.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0)');
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    params.push(like);
    const i = `$${params.length}`;
    clauses.push(`(p.name ILIKE ${i} OR p.brand ILIKE ${i} OR p.short_description ILIKE ${i} OR c.name ILIKE ${i} OR array_to_string(p.tags, ' ') ILIKE ${i})`);
  }
  if (f.ids) add('p.id = ANY(?)', f.ids);
  return { where: clauses.join(' AND '), params };
}

async function listCards(filters, { sort = 'newest', limit = 12, offset = 0 } = {}) {
  const { where, params } = buildFilters(filters);
  const order = SORTS[sort] || SORTS.newest;
  const countSql = `SELECT COUNT(*)::int AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where}`;
  const listSql = `${CARD_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
  const [count, list] = await Promise.all([db.query(countSql, params), db.query(listSql, params)]);
  return { total: count.rows[0].n, items: list.rows.map(cardDto) };
}

async function cardsBySlugs(slugs) {
  if (!slugs.length) return [];
  const { rows } = await db.query(`${CARD_SELECT} WHERE p.slug = ANY($1) AND p.is_active`, [slugs]);
  const bySlug = new Map(rows.map((r) => [r.slug, { ...cardDto(r), specs: r.specs }]));
  return slugs.map((s) => bySlug.get(s)).filter(Boolean);
}

async function cardsByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(`${CARD_SELECT} WHERE p.id = ANY($1) AND p.is_active`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, cardDto(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// Recomputes denormalised columns after variants change.
async function refreshProductAggregates(client, productId) {
  await client.query(
    `UPDATE products SET
       min_price = COALESCE((SELECT MIN(price) FROM variants WHERE product_id = $1 AND is_active), 0),
       -- original price of the cheapest variant, used for the "-x%" badge
       min_compare_price = (SELECT compare_at_price FROM variants WHERE product_id = $1 AND is_active
                             ORDER BY price, id LIMIT 1),
       updated_at = NOW()
     WHERE id = $1`,
    [productId],
  );
}

// Flat document sent to the search service through RabbitMQ.
async function searchDocuments(ids = null) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.slug, p.brand, p.short_description, p.description, p.tags, p.min_price, p.min_compare_price,
            p.avg_rating, p.rating_count, p.sold_count, p.created_at, p.is_active,
            c.name AS category_name, c.slug AS category_slug,
            (SELECT string_agg(v.name, ' | ') FROM variants v WHERE v.product_id = p.id) AS variant_names,
            EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0) AS in_stock
       FROM products p JOIN categories c ON c.id = p.category_id
      ${ids ? 'WHERE p.id = ANY($1)' : ''}`,
    ids ? [ids] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    brand: r.brand,
    category: r.category_slug,
    categoryName: r.category_name,
    shortDescription: r.short_description,
    description: r.description,
    variants: r.variant_names || '',
    tags: r.tags,
    price: r.min_price,
    discountPercent: discountPercent(Number(r.min_price), Number(r.min_compare_price)),
    onSale: discountPercent(Number(r.min_price), Number(r.min_compare_price)) > 0,
    avgRating: Number(r.avg_rating),
    ratingCount: r.rating_count,
    soldCount: r.sold_count,
    createdAt: r.created_at,
    isActive: r.is_active,
    inStock: r.in_stock,
  }));
}

async function publishProductChanges(ids) {
  const docs = await searchDocuments(ids);
  for (const doc of docs) await mq.publishEvent('product.upserted', doc);
}

async function publishFullCatalog() {
  const docs = await searchDocuments();
  await mq.publishEvent('catalog.snapshot', { products: docs, at: new Date().toISOString() });
  return docs.length;
}

module.exports = {
  SORTS, cardDto, listCards, cardsByIds, cardsBySlugs, refreshProductAggregates, discountPercent,
  searchDocuments, publishProductChanges, publishFullCatalog,
};
