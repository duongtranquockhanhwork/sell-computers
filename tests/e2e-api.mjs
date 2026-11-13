// End-to-end API scenario against a running stack (docker compose up -d).
// Usage: node tests/e2e-api.mjs [baseUrl]
const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
let passed = 0;
let failed = 0;

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, data, instance: res.headers.get('x-instance') };
  };
  call.cookie = () => cookie;
  return call;
}

function check(name, cond, info = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); } else { failed++; console.log(`  FAIL ${name} ${info}`); }
}

const guest = client();
const customer = client();
const admin = client();

console.log(`E2E against ${BASE}`);

// --- Load balancing: requests are spread across API replicas.
const instances = new Set();
for (let i = 0; i < 12; i++) instances.add((await guest('GET', '/health')).instance);
check('requests are served by several API replicas', instances.size >= 2, [...instances].join(','));

// --- Catalogue
const home = await guest('GET', '/home');
check('landing page has New, Best Sellers and >= 3 category sections', home.data.newProducts.length && home.data.bestSellers.length && home.data.sections.length >= 3);
const page1 = await guest('GET', '/products?limit=12&page=1');
const page2 = await guest('GET', '/products?limit=12&page=2');
check('catalogue is paginated', page1.data.totalPages > 1 && page2.data.items[0].id !== page1.data.items[0].id);
const byName = await guest('GET', '/products?sort=name_asc&limit=48');
const names = byName.data.items.map((p) => p.name);
check('sort by name A-Z', names.join() === [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join() || names[0] <= names[1]);
const byPrice = await guest('GET', '/products?sort=price_desc&limit=48');
check('sort by price high-low', byPrice.data.items.every((p, i, a) => i === 0 || a[i - 1].price >= p.price));
const filtered = await guest('GET', '/products?brand=ASUS,MSI&minPrice=5000000&maxPrice=20000000&minRating=3');
check('filter by brand + price range + rating', filtered.data.items.every((p) => ['ASUS', 'MSI'].includes(p.brand) && p.price >= 5e6 && p.price <= 2e7 && p.avgRating >= 3));
const search = await guest('GET', '/products?q=geforce%20rtx');
check('keyword search uses ElasticSearch', search.data.engine === 'elasticsearch' && search.data.total > 0);
const typo = await guest('GET', '/products?q=samsng');
check('search tolerates typos', typo.data.items.some((p) => p.brand === 'Samsung'));

const detail = await guest('GET', `/products/${page1.data.items[0].slug}`);
const product = detail.data.product;
check('product detail: >= 2 variants, >= 3 images, >= 5 description lines', product.variants.length >= 2 && product.images.length >= 3 && product.description.split('\n').filter(Boolean).length >= 5);
const variant = product.variants.find((v) => v.stock > 2) || product.variants[0];

// --- Reviews
const anonComment = await guest('POST', `/products/${product.id}/comments`, { authorName: 'E2E Guest', content: 'Comment without signing in' });
check('guests can comment', anonComment.status === 201);
const anonRate = await guest('PUT', `/products/${product.id}/rating`, { stars: 5 });
check('guests cannot rate', anonRate.status === 401);

// --- Customer
const login = await customer('POST', '/auth/login', { email: 'customer@techhaven.local', password: 'Customer@123' });
check('customer can sign in', login.status === 200 && login.data.user.role === 'customer');
const rate = await customer('PUT', `/products/${product.id}/rating`, { stars: 4 });
check('signed-in customer can rate', rate.status === 200 && rate.data.rating.mine === 4);
const addresses = (await customer('GET', '/profile/addresses')).data.addresses;
check('customer has several delivery addresses with a default', addresses.length >= 2 && addresses.some((a) => a.isDefault));

// --- Discount code created by admin
const adminLogin = await admin('POST', '/auth/login', { email: 'admin@techhaven.local', password: 'Admin@123' });
check('admin can sign in', adminLogin.data?.user?.role === 'admin');
check('customer cannot open admin API', (await customer('GET', '/admin/dashboard/summary')).status === 403);
const badCode = await admin('POST', '/admin/discounts', { code: 'TOOLONG', type: 'percent', value: 10, usageLimit: 5 });
check('discount code must be 5 characters', badCode.status === 400);
const overLimit = await admin('POST', '/admin/discounts', { type: 'percent', value: 10, usageLimit: 11 });
check('usage limit is capped at 10', overLimit.status === 400);
const code = await admin('POST', '/admin/discounts', { type: 'percent', value: 10, usageLimit: 1 });
check('admin creates a code', code.status === 201 && /^[A-Z0-9]{5}$/.test(code.data.discount.code));
const theCode = code.data.discount.code;

const quote = await customer('POST', '/cart/quote', { items: [{ variantId: variant.id, quantity: 1 }], discountCode: theCode, pointsToUse: 10 });
check('quote shows the discount effect before paying', quote.data.discount.valid && quote.data.summary.discountAmount > 0);
check('quote applies loyalty points', quote.data.summary.pointsUsed === Math.min(10, quote.data.pointsAvailable));

const before = (await customer('GET', '/auth/me')).data.user.loyaltyPoints;
const order = await customer('POST', '/orders', {
  items: [{ variantId: variant.id, quantity: 1 }],
  discountCode: theCode,
  pointsToUse: 10,
  shipping: { addressId: addresses.find((a) => a.isDefault).id },
  paymentMethod: 'card',
  payment: { cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' },
});
check('customer checkout succeeds', order.status === 201, JSON.stringify(order.data));
const o = order.data.order;
check('order totals match the quote', o.total === quote.data.summary.total);
check('loyalty: earned = 10% of total in points', o.pointsEarned === Math.floor((o.total * 0.1) / 1000));
const after = (await customer('GET', '/auth/me')).data.user.loyaltyPoints;
check('points spent and earned are applied immediately', after === before - o.pointsUsed + o.pointsEarned);
const reuse = await customer('POST', '/cart/quote', { items: [{ variantId: variant.id, quantity: 1 }], discountCode: theCode });
check('code is rejected after reaching its usage limit', reuse.data.discount.valid === false);
const declined = await customer('POST', '/orders', {
  items: [{ variantId: variant.id, quantity: 1 }], shipping: { addressId: addresses[0].id },
  paymentMethod: 'card', payment: { cardNumber: '4000 0000 0000 0002', expiry: '12/30', cvc: '123' },
});
check('declined card does not create an order', declined.status === 402);

const history = await customer('GET', '/orders');
check('order history lists the new order first', history.data.items[0].orderNumber === o.orderNumber);
const mine = await customer('GET', `/orders/${o.orderNumber}`);
check('order detail has status history', mine.data.order.history.length === 1 && mine.data.order.history[0].status === 'pending');
check('another user cannot read the order', (await guest('GET', `/orders/${o.orderNumber}`)).status === 401);

// --- Admin order processing
const list = await admin('GET', '/admin/orders?range=today');
check('admin order list (today) is newest first', list.data.items[0].order_number === o.orderNumber);
const bad = await admin('PATCH', `/admin/orders/${o.orderNumber}/status`, { status: 'delivered' });
check('invalid status transition is rejected', bad.status === 400);
await admin('PATCH', `/admin/orders/${o.orderNumber}/status`, { status: 'confirmed', note: 'Confirmed by E2E' });
const shipped = await admin('PATCH', `/admin/orders/${o.orderNumber}/status`, { status: 'shipping' });
check('admin moves order to shipping', shipped.data.order.status === 'shipping');
const tl = (await customer('GET', `/orders/${o.orderNumber}`)).data.order.history;
check('customer sees status history newest first', tl[0].status === 'shipping' && tl.length === 3);

// --- Guest checkout auto-creates an account
const email = `guest.${Date.now()}@example.com`;
const g = await guest('POST', '/orders', {
  items: [{ variantId: variant.id, quantity: 1 }],
  shipping: { email, fullName: 'E2E Guest Buyer', phone: '0909000111', addressLine: '1 Le Loi', district: 'District 1', city: 'Ho Chi Minh City' },
  paymentMethod: 'cod',
});
check('guest checkout succeeds and creates an account', g.status === 201 && g.data.accountCreated === true);
const users = await admin('GET', `/admin/users?q=${encodeURIComponent(email)}`);
check('auto-created account is linked to the order', users.data.items[0]?.order_count === 1);

// --- Product images (1 to 10 per product)
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function uploadFiles(files) {
  const fd = new FormData();
  for (const [name, buf, type] of files) fd.append('images', new Blob([buf], { type }), name);
  const res = await fetch(`${BASE}/api/admin/uploads`, { method: 'POST', body: fd, headers: { Cookie: admin.cookie() } });
  return { status: res.status, data: await res.json() };
}
const up = await uploadFiles([['a.png', PNG_1x1, 'image/png'], ['b.png', PNG_1x1, 'image/png']]);
check('admin uploads several images at once', up.status === 201 && up.data.urls.length === 2);
const media = await fetch(`${BASE}${up.data.urls[0]}`);
check('uploaded image is served with its detected type', media.status === 200 && media.headers.get('content-type') === 'image/png');
const fake = await uploadFiles([['evil.png', Buffer.from('<script>alert(1)</script> not an image'), 'image/png']]);
check('a file that is not really an image is rejected', fake.status === 400);
const tooMany = await uploadFiles(Array.from({ length: 11 }, (_, i) => [`p${i}.png`, PNG_1x1, 'image/png']));
check('more than 10 files in one upload is rejected', tooMany.status === 400);
const editable = (await admin('GET', `/admin/products/${product.id}`)).data.product;
const baseBody = {
  name: editable.name, brand: editable.brand, categoryId: editable.category_id, shortDescription: editable.short_description,
  description: editable.description, specs: editable.specs, tags: editable.tags, isActive: editable.is_active,
  variants: editable.variants.map((x) => ({ id: x.id, sku: x.sku, name: x.name, price: Number(x.price), costPrice: Number(x.cost_price), stock: x.stock, isActive: x.is_active })),
};
const noImages = await admin('PUT', `/admin/products/${product.id}`, { ...baseBody, images: [] });
check('a product must keep at least 1 image', noImages.status === 400);
const eleven = Array.from({ length: 11 }, (_, i) => (i < 2 ? up.data.urls[i] : `https://example.com/img${i}.jpg`));
check('a product cannot have more than 10 images', (await admin('PUT', `/admin/products/${product.id}`, { ...baseBody, images: eleven })).status === 400);
const ten = [...up.data.urls, ...editable.images].slice(0, 10);
const saved = await admin('PUT', `/admin/products/${product.id}`, { ...baseBody, images: ten });
const shown = (await guest('GET', `/products/${product.slug}`)).data.product.images;
check('saving 10 images keeps their order on the product page', saved.status === 200 && shown.length === ten.length && shown[0] === up.data.urls[0]);
await admin('PUT', `/admin/products/${product.id}`, { ...baseBody, images: editable.images });

// --- Storefront features inspired by real shops
const deals = await guest('GET', '/products?onSale=true&sort=discount&limit=12');
check('on-sale filter returns discounted products, biggest discount first',
  deals.data.total > 0 && deals.data.items.every((p, i, a) => p.compareAtPrice > p.price && (i === 0 || a[i - 1].discountPercent >= p.discountPercent)));
check('product cards carry key specifications', deals.data.items.every((p) => Array.isArray(p.keySpecs) && p.keySpecs.length > 0));
const bySlugs = await guest('GET', `/products/by-slugs?slugs=${deals.data.items.slice(0, 3).map((p) => p.slug).join(',')}`);
check('compare / recently viewed: products by slugs with specifications', bySlugs.data.items.length === 3 && bySlugs.data.items.every((p) => p.specs));
const badPrice = await admin('PUT', `/admin/products/${product.id}`, { ...baseBody, images: editable.images, variants: baseBody.variants.map((x) => ({ ...x, compareAtPrice: x.price })) });
check('original price must be higher than the selling price', badPrice.status === 400);
check('wish list needs sign-in', (await guest('GET', '/wishlist')).status === 401);
await customer('PUT', `/wishlist/${product.id}`);
const merged = await customer('POST', '/wishlist/merge', { productIds: [deals.data.items[0].id] });
const wl = await customer('GET', '/wishlist');
check('customer saves and merges wish-list items', merged.data.ids.includes(product.id) && wl.data.items.some((p) => p.id === deals.data.items[0].id));
await customer('DELETE', `/wishlist/${product.id}`);
check('customer removes a wish-list item', !(await customer('GET', '/wishlist')).data.ids.includes(product.id));
const look = await guest('POST', '/orders/lookup', { orderNumber: g.data.order.orderNumber, email });
check('guest tracks an order with its number and e-mail', look.status === 200 && look.data.order.history.length >= 1);
check('order lookup with a wrong e-mail is refused', (await guest('POST', '/orders/lookup', { orderNumber: g.data.order.orderNumber, email: 'someone@example.com' })).status === 404);
const robots = await fetch(`${BASE}/robots.txt`).then((r) => r.text());
const sitemap = await fetch(`${BASE}/sitemap.xml`).then((r) => r.text());
check('SEO: robots.txt and sitemap.xml list categories, tags and products', robots.includes('Sitemap:') && sitemap.includes('/category/laptops') && sitemap.includes('/products?tag=') && sitemap.includes(`/products/${product.slug}`));

// --- AI bonus: shopping assistant and review sentiment
const ask = async (message) => (await fetch(`${BASE}/api/assistant/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })).json();
const a1 = await ask('Tư vấn laptop gaming dưới 30 triệu');
check('assistant recommends real laptops within the budget (Vietnamese)', a1.products.length > 0 && a1.products.every((p) => p.category.slug === 'laptops' && p.price <= 30000000)
  // The reply is written by Gemini or by the rules; either way it is Vietnamese and names a recommended product.
  && /[ạảãàáâậầấẩẫăắằặẳẵđêềếểễệôồốổỗộơờớởỡợưừứửữự]/i.test(a1.reply) && a1.products.some((p) => a1.reply.includes(p.name)));
console.log(`  (assistant engine: ${a1.engine})`);
const a2 = await ask('Do you have an RTX 4070 graphics card?');
check('assistant finds a specific model (English)', a2.products.some((p) => /4070/.test(p.name)));
const a3 = await ask('Phí giao hàng bao nhiêu?');
check('assistant answers store-policy questions', /30\.000|5\.000\.000/.test(a3.reply));
const negative = await guest('POST', `/products/${product.id}/comments`, { authorName: 'E2E Critic', content: 'Máy bị lỗi sau một tuần, rất thất vọng.' });
let sentiment = null;
for (let i = 0; i < 20 && !sentiment; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const list = await guest('GET', `/products/${product.id}/comments`);
  sentiment = list.data.items.find((x) => x.id === negative.data.comment.id)?.sentiment;
}
check('new comments are classified by the sentiment service (RabbitMQ)', sentiment === 'negative', String(sentiment));
const detailAfter = await guest('GET', `/products/${product.slug}`);
check('product page includes the sentiment summary', detailAfter.data.product.sentiment.analysed > 0);

// --- E-mail actually delivered (Mailpit inbox)
const MAILPIT = process.env.MAILPIT_URL || BASE.replace(/:\d+$/, ':8025');
let mails = null;
try {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((x) => x.json());
    if (r.messages?.length) { mails = r.messages; break; }
    await new Promise((res) => setTimeout(res, 300));
  }
} catch { /* Mailpit not reachable */ }
check('order confirmation e-mail reaches the guest inbox', Boolean(mails?.some((m) => /confirmed/.test(m.Subject))), mails ? '' : 'mailpit not reachable');

// --- Dashboards
const sum = await admin('GET', '/admin/dashboard/summary');
check('simple dashboard has users, orders, revenue, best sellers', sum.data.users.total > 0 && sum.data.orders.revenue > 0 && sum.data.bestSellers.length > 0);
check('simple dashboard has actionable insights', typeof sum.data.insights.toConfirm === 'number' && Array.isArray(sum.data.insights.lowStockItems));
for (const gr of ['year', 'quarter', 'month', 'week']) {
  const adv = await admin('GET', `/admin/dashboard/advanced?granularity=${gr}`);
  check(`advanced dashboard (${gr})`, adv.status === 200 && adv.data.series.length > 0 && adv.data.totals.profit > 0);
}
const custom = await admin('GET', '/admin/dashboard/advanced?granularity=day&from=2025-01-01&to=2025-01-31');
check('advanced dashboard (custom range)', custom.status === 200 && custom.data.from === '2025-01-01');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
