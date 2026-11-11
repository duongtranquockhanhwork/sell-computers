const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src/templates');

const order = {
  orderNumber: 'TH261111000001', fullName: 'An <script>', email: 'an@example.com', phone: '0901234567',
  shippingAddress: '1 Le Loi, District 1, Ho Chi Minh City', createdAt: new Date().toISOString(),
  items: [{ productName: 'Samsung 990 PRO', variantName: '1TB', quantity: 2, lineTotal: 5380000 }],
  subtotal: 5380000, discountAmount: 0, tax: 538000, shippingFee: 0, pointsUsed: 0, pointsDiscount: 0,
  total: 5918000, pointsEarned: 591, paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'pending', history: [],
};

test('order confirmation lists items, totals and escapes HTML', () => {
  const m = render('order-confirmation', { order, accountCreated: false });
  assert.match(m.subject, /TH261111000001/);
  assert.match(m.html, /5,918,000₫/);
  assert.match(m.html, /591 loyalty points/);
  assert.ok(!m.html.includes('<script>'));
});

test('guest checkout mail contains the set-password link', () => {
  const m = render('order-confirmation', { order, accountCreated: true, setupLink: 'http://x/set-password?token=abc' });
  assert.match(m.html, /set-password\?token=abc/);
});

test('every template renders', () => {
  for (const t of ['account-setup', 'password-reset', 'order-status']) {
    const m = render(t, { fullName: 'An', link: 'http://x', order });
    assert.ok(m.subject && m.html && m.text);
  }
});
