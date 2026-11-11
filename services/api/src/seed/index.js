// Schema migration and demo data. Runs at API start-up under a PostgreSQL
// advisory lock so that only one of the replicas performs it.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');
const { slugify } = require('../lib/http');
const pricing = require('../lib/pricing');
const { categories, products, blurbs } = require('./catalog-data');

const LOCK_KEY = 4242001;

// Deterministic pseudo-random generator: the same demo data on every machine.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20250601);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const round1000 = (n) => Math.round(n / 1000) * 1000;

async function insertMany(client, table, columns, rows, suffix = '') {
  const out = [];
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    const res = await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ${suffix}`, params);
    out.push(...res.rows);
  }
  return out;
}

const FIRST = ['Anh', 'Bao', 'Chi', 'Dung', 'Giang', 'Hai', 'Hanh', 'Hieu', 'Hoa', 'Hung', 'Khanh', 'Lan', 'Linh', 'Long', 'Mai', 'Minh', 'Nam', 'Ngoc', 'Nhung', 'Phong', 'Phuc', 'Quan', 'Quynh', 'Son', 'Tam', 'Thao', 'Thanh', 'Trang', 'Trung', 'Tuan', 'Tung', 'Vy', 'Yen'];
const LAST = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Huynh', 'Phan', 'Vu', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong'];
const MIDDLE = ['Van', 'Thi', 'Minh', 'Duc', 'Thanh', 'Ngoc', 'Quoc', 'Hoai', 'Gia', 'Bao'];
const PLACES = [
  ['District 1', 'Ho Chi Minh City'], ['District 3', 'Ho Chi Minh City'], ['District 7', 'Ho Chi Minh City'],
  ['Binh Thanh', 'Ho Chi Minh City'], ['Thu Duc', 'Ho Chi Minh City'], ['Go Vap', 'Ho Chi Minh City'],
  ['Ba Dinh', 'Ha Noi'], ['Cau Giay', 'Ha Noi'], ['Dong Da', 'Ha Noi'], ['Hai Chau', 'Da Nang'],
  ['Ninh Kieu', 'Can Tho'], ['Bien Hoa', 'Dong Nai'], ['Thu Dau Mot', 'Binh Duong'], ['Nha Trang', 'Khanh Hoa'],
];
const STREETS = ['Nguyen Hue', 'Le Loi', 'Hai Ba Trung', 'Vo Van Tan', 'Cach Mang Thang 8', 'Nguyen Thi Minh Khai', 'Dien Bien Phu', 'Tran Hung Dao', 'Ly Thuong Kiet', 'Nguyen Van Linh', 'Pham Van Dong', 'Xuan Thuy'];
const COMMENTS = [
  'Delivered quickly and well packed. Works exactly as described.',
  'Great value for the price, I would buy again.',
  'Performance is excellent, temperatures stay low even under load.',
  'The staff helped me choose the right variant for my build. Thanks!',
  'Arrived in two days to Ha Noi. Product is genuine with full warranty.',
  'Does the job well. Packaging could be a little better.',
  'Very happy with this upgrade, my PC feels much faster now.',
  'Good product but delivery took a bit longer than expected.',
  'Exactly what I needed for work from home.',
  'Build quality is solid. Recommended for students.',
  'Is there a version with more storage coming soon?',
  'Installed in ten minutes, no driver issues at all.',
  'The fan is louder than I expected and the box was damaged. Disappointed.',
  'Sản phẩm chính hãng, giao hàng nhanh, đóng gói cẩn thận. Rất hài lòng!',
  'Máy chạy mượt, màn hình đẹp, giá tốt so với cấu hình.',
  'Hàng tạm ổn nhưng giao hơi chậm, nhân viên hỗ trợ nhiệt tình.',
  'Máy bị lỗi sau một tuần, phải mang đi bảo hành, khá thất vọng.',
  'Shop tư vấn kỹ, sẽ ủng hộ tiếp.',
];

function fullName() {
  return `${pick(LAST)} ${pick(MIDDLE)} ${pick(FIRST)}`;
}

function address(name) {
  const [district, city] = pick(PLACES);
  return { recipient: name, phone: `09${between(10000000, 99999999)}`, address_line: `${between(1, 499)} ${pick(STREETS)} Street`, ward: `Ward ${between(1, 15)}`, district, city };
}

async function seedCatalog(client) {
  const cats = await insertMany(
    client, 'categories', ['name', 'slug', 'description', 'icon', 'position'],
    categories.map((c, i) => [c.name, c.slug, c.description, c.icon, i]),
    'RETURNING id, slug, icon',
  );
  const catBySlug = new Map(cats.map((c) => [c.slug, c]));
  const allVariants = [];
  let hue = 0;
  let index = 0;
  const now = Date.now();
  for (const [slug, list] of Object.entries(products)) {
    const cat = catBySlug.get(slug);
    for (const [name, brand, short, base, specs, variants, tags] of list) {
      index += 1;
      hue = (hue + 47) % 360;
      const specLines = Object.entries(specs).map(([k, v]) => `• ${k}: ${v}`).join('\n');
      const description = [
        `${name} by ${brand}. ${short}`,
        ...blurbs[slug],
        '',
        'Key specifications:',
        specLines,
      ].join('\n');
      // Spread creation dates: some products are "new" (last 45 days), most are older.
      const ageDays = index % 5 === 0 ? between(2, 40) : between(60, 1060);
      const created = new Date(now - ageDays * 86400000);
      const { rows } = await client.query(
        `INSERT INTO products (name, slug, brand, category_id, short_description, description, specs, tags, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
        [name, slugify(name), brand, cat.id, short, description, specs, tags, created],
      );
      const pid = rows[0].id;
      const t = encodeURIComponent(name);
      const b = encodeURIComponent(brand);
      for (let view = 0; view < 4; view++) {
        await client.query('INSERT INTO product_images (product_id, url, position) VALUES ($1,$2,$3)', [
          pid, `/api/media/gen/${cat.icon}/${hue}/${view}.svg?t=${t}&b=${b}`, view,
        ]);
      }
      const onSale = index % 2 === 1;
      for (const [i, [label, delta]] of variants.entries()) {
        const price = round1000(base + delta);
        const cost = round1000(price * (0.78 + rand() * 0.1));
        const stock = between(0, 10) === 0 ? 0 : between(4, 60);
        // About half of the products are on promotion: an original price 8-30% higher.
        const compareAt = onSale ? round1000(price * (1.08 + rand() * 0.22)) : null;
        const sku = `${slugify(brand).slice(0, 4).toUpperCase()}-${String(pid).padStart(3, '0')}-${i + 1}`;
        const v = await client.query(
          `INSERT INTO variants (product_id, sku, name, price, cost_price, stock, position, compare_at_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [pid, sku, label, price, cost, stock, i, compareAt],
        );
        allVariants.push({ id: v.rows[0].id, productId: pid, productName: name, name: label, price, cost, categoryId: cat.id, created });
      }
      await client.query(
        `UPDATE products SET min_price = (SELECT MIN(price) FROM variants WHERE product_id = $1),
                min_compare_price = (SELECT compare_at_price FROM variants WHERE product_id = $1 ORDER BY price, id LIMIT 1)
          WHERE id = $1`,
        [pid],
      );
    }
  }
  return allVariants;
}

async function seedPeopleAndOrders(client, variants) {
  const start = new Date('2024-01-01T08:00:00+07:00').getTime();
  const now = Date.now();
  const span = now - start;

  // Customers, registered progressively over the period.
  const demoHash = await bcrypt.hash('Customer@123', 10);
  const people = [{ email: 'customer@techhaven.local', name: 'Nguyen Van An', created: new Date(start + 5 * 86400000), hash: demoHash }];
  for (let i = 1; i < 160; i++) {
    const name = fullName();
    const created = new Date(start + Math.pow(rand(), 0.8) * span);
    people.push({ email: `${slugify(name).replace(/-/g, '.')}.${i}@example.com`, name, created, hash: null });
  }
  const users = await insertMany(
    client, 'users', ['email', 'full_name', 'phone', 'password_hash', 'created_at', 'updated_at'],
    people.map((p) => [p.email, p.name, `09${between(10000000, 99999999)}`, p.hash, p.created, p.created]),
    'RETURNING id, email, full_name, created_at',
  );
  const addrRows = [];
  users.forEach((u, i) => {
    const a = address(u.full_name);
    addrRows.push([u.id, a.recipient, a.phone, a.address_line, a.ward, a.district, a.city, true]);
    if (i === 0) {
      const b = { recipient: 'Nguyen Van An (Office)', phone: '0912345678', address_line: '19 Nguyen Huu Tho Street', ward: 'Tan Phong Ward', district: 'District 7', city: 'Ho Chi Minh City' };
      addrRows.push([u.id, b.recipient, b.phone, b.address_line, b.ward, b.district, b.city, false]);
    }
  });
  await insertMany(client, 'addresses', ['user_id', 'recipient', 'phone', 'address_line', 'ward', 'district', 'city', 'is_default'], addrRows);
  const addrByUser = new Map();
  for (const r of addrRows) if (r[7]) addrByUser.set(r[0], r);

  // Discount codes created by the administrator.
  const codes = await insertMany(
    client, 'discount_codes', ['code', 'type', 'value', 'usage_limit', 'created_at'],
    [
      ['WELC5', 'percent', 5, 10, new Date('2024-02-01')],
      ['TECH1', 'fixed', 200000, 10, new Date('2024-06-15')],
      ['GAME7', 'percent', 7, 8, new Date('2025-03-10')],
      ['SV100', 'fixed', 100000, 10, new Date('2025-09-01')],
      ['VIP10', 'percent', 10, 5, new Date('2026-01-20')],
      ['NEW26', 'percent', 8, 10, new Date('2026-10-01')],
    ],
    'RETURNING id, code, type, value, usage_limit, created_at',
  );
  const codeUses = new Map(codes.map((c) => [c.id, 0]));

  // Historical orders with a gentle growth trend and seasonality (Tet, back-to-school, year end).
  const orders = [];
  const totalOrders = 1100;
  for (let i = 0; i < totalOrders; i++) {
    const t = start + Math.pow(rand(), 0.75) * span;
    const d = new Date(t);
    const month = d.getMonth();
    if ((month === 6 || month === 7 || month === 11 || month === 0) === false && rand() < 0.12) continue;
    orders.push(d);
  }
  orders.sort((a, b) => a - b);
  const pointsByUser = new Map();
  const soldByProduct = new Map();
  let seq = 0;

  for (const createdAt of orders) {
    const candidates = users.filter((u) => new Date(u.created_at) <= createdAt);
    if (!candidates.length) continue;
    const u = rand() < 0.08 ? users[0] : pick(candidates);
    const lines = [];
    const n = rand() < 0.65 ? 1 : rand() < 0.75 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const v = pick(variants.filter((x) => x.created <= createdAt) .concat([]));
      if (!v || lines.some((l) => l.id === v.id)) continue;
      const cheap = v.price < 3000000;
      lines.push({ ...v, quantity: cheap && rand() < 0.3 ? 2 : 1 });
    }
    if (!lines.length) continue;

    let discount = null;
    if (rand() < 0.04) {
      // Leave a few uses on every code so the demo can still apply them.
      const open = codes.filter((c) => new Date(c.created_at) <= createdAt && codeUses.get(c.id) < c.usage_limit - 3);
      if (open.length) discount = pick(open);
    }
    const q = pricing.computeQuote({
      lines: lines.map((l) => ({ unitPrice: l.price, quantity: l.quantity })),
      discount,
      pointsRequested: 0,
      pointsAvailable: 0,
    });
    const age = (now - createdAt.getTime()) / 86400000;
    let status = 'delivered';
    if (rand() < 0.05) status = 'cancelled';
    else if (age < 2) status = pick(['pending', 'pending', 'confirmed']);
    else if (age < 5) status = pick(['confirmed', 'shipping', 'shipping', 'delivered']);
    else if (age < 8) status = pick(['shipping', 'delivered', 'delivered']);

    seq += 1;
    const stamp = createdAt.toISOString().slice(2, 10).replace(/-/g, '');
    const a = addrByUser.get(u.id);
    const method = pick(['cod', 'cod', 'card', 'bank_transfer']);
    const paid = method !== 'cod' || status === 'delivered';
    const { rows } = await client.query(
      `INSERT INTO orders (order_number, user_id, email, full_name, phone, shipping_address, subtotal, discount_code_id,
                           discount_amount, tax, shipping_fee, points_used, points_discount, total, points_earned,
                           payment_method, payment_status, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [`TH${stamp}${String(seq).padStart(6, '0')}`, u.id, u.email, a[1], a[2], [a[3], a[4], a[5], a[6]].join(', '),
        q.subtotal, discount?.id ?? null, q.discountAmount, q.tax, q.shippingFee, q.total, q.pointsEarned,
        method, paid ? 'paid' : 'unpaid', status, createdAt],
    );
    const oid = rows[0].id;
    if (discount && status !== 'cancelled') codeUses.set(discount.id, codeUses.get(discount.id) + 1);
    await insertMany(
      client, 'order_items',
      ['order_id', 'product_id', 'variant_id', 'product_name', 'variant_name', 'category_id', 'unit_price', 'unit_cost', 'quantity', 'line_total'],
      lines.map((l) => [oid, l.productId, l.id, l.productName, l.name, l.categoryId, l.price, l.cost, l.quantity, l.price * l.quantity]),
    );
    const flow = { pending: ['pending'], confirmed: ['pending', 'confirmed'], shipping: ['pending', 'confirmed', 'shipping'], delivered: ['pending', 'confirmed', 'shipping', 'delivered'], cancelled: ['pending', 'cancelled'] }[status];
    const notes = { pending: 'Order placed', confirmed: 'Order confirmed by TechHaven', shipping: 'Handed over to the carrier', delivered: 'Delivered to the customer', cancelled: 'Cancelled at the customer request' };
    await insertMany(
      client, 'order_status_history', ['order_id', 'status', 'note', 'created_at'],
      flow.map((s, i) => [oid, s, notes[s], new Date(createdAt.getTime() + i * (between(6, 30) * 3600000))].map((x) => (x instanceof Date && x > new Date() ? new Date() : x))),
    );
    if (status !== 'cancelled') {
      pointsByUser.set(u.id, (pointsByUser.get(u.id) || 0) + q.pointsEarned);
      for (const l of lines) soldByProduct.set(l.productId, (soldByProduct.get(l.productId) || 0) + l.quantity);
    }
  }

  for (const [id, used] of codeUses) await client.query('UPDATE discount_codes SET used_count = $2 WHERE id = $1', [id, used]);
  for (const [id, pts] of pointsByUser) await client.query('UPDATE users SET loyalty_points = $2 WHERE id = $1', [id, Math.round(pts * 0.4)]);
  for (const [id, n] of soldByProduct) await client.query('UPDATE products SET sold_count = $2 WHERE id = $1', [id, n]);

  // Reviews: comments from members and guests, and ratings from members.
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const ratingRows = [];
  const commentRows = [];
  const seen = new Set();
  for (const pid of productIds) {
    const count = between(2, 9);
    for (let i = 0; i < count; i++) {
      const u = pick(users.slice(1));
      const key = `${pid}:${u.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const stars = pick([5, 5, 5, 4, 4, 4, 3, 5, 4, 2]);
      const at = new Date(now - between(1, 500) * 86400000);
      ratingRows.push([pid, u.id, stars, at, at]);
      if (rand() < 0.7) commentRows.push([pid, u.id, u.full_name, pick(COMMENTS), at]);
    }
    if (rand() < 0.5) commentRows.push([pid, null, pick(['Guest buyer', 'Minh (guest)', 'Hoang', 'A visitor']), pick(COMMENTS), new Date(now - between(1, 300) * 86400000)]);
  }
  await insertMany(client, 'ratings', ['product_id', 'user_id', 'stars', 'created_at', 'updated_at'], ratingRows);
  await insertMany(client, 'comments', ['product_id', 'user_id', 'author_name', 'content', 'created_at'], commentRows);
  await client.query(
    `UPDATE products p SET avg_rating = COALESCE(r.avg, 0), rating_count = COALESCE(r.n, 0)
       FROM (SELECT product_id, ROUND(AVG(stars)::numeric, 2) AS avg, COUNT(*) AS n FROM ratings GROUP BY product_id) r
      WHERE r.product_id = p.id`,
  );
  return { users: users.length, orders: seq };
}

async function migrateAndSeed() {
  const client = await db.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

    // The single administrator account.
    const admin = await client.query(`SELECT id FROM users WHERE role = 'admin'`);
    if (!admin.rowCount) {
      await client.query(
        `INSERT INTO users (email, full_name, password_hash, role) VALUES ($1, 'TechHaven Administrator', $2, 'admin')`,
        [config.adminEmail, await bcrypt.hash(config.adminPassword, 10)],
      );
      console.log(`[seed] administrator ${config.adminEmail} created`);
    }

    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM categories');
    if (rows[0].n === 0 && config.seedDemoData) {
      console.log('[seed] loading demo catalogue, customers and order history...');
      const t0 = Date.now();
      await client.query('BEGIN');
      const variants = await seedCatalog(client);
      const stats = await seedPeopleAndOrders(client, variants);
      await client.query('COMMIT');
      console.log(`[seed] done in ${Date.now() - t0} ms: ${variants.length} variants, ${stats.users} customers, ${stats.orders} orders`);
      return true;
    }
    return false;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { migrateAndSeed };
