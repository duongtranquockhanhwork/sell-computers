const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/lib/pricing');

test('loyalty: 1,000,000 VND earns 100 points worth 100,000 VND', () => {
  assert.equal(p.pointsForTotal(1000000), 100);
  assert.equal(p.pointsForTotal(1000000) * p.POINT_VALUE, 100000);
  assert.equal(p.pointsForTotal(9999), 0);
});

test('discount codes are exactly five alphanumeric characters', () => {
  assert.ok(p.isValidCodeFormat('WELC5'));
  assert.ok(p.isValidCodeFormat(' vip10 '));
  assert.ok(!p.isValidCodeFormat('ABCD'));
  assert.ok(!p.isValidCodeFormat('ABCDEF'));
  assert.ok(!p.isValidCodeFormat('AB-CD'));
});

test('percent and fixed discounts never exceed the subtotal', () => {
  assert.equal(p.discountAmount(1000000, { type: 'percent', value: 10 }), 100000);
  assert.equal(p.discountAmount(150000, { type: 'fixed', value: 200000 }), 150000);
  assert.equal(p.discountAmount(150000, null), 0);
});

test('quote: tax, shipping fee and total', () => {
  const q = p.computeQuote({ lines: [{ unitPrice: 1000000, quantity: 2 }] });
  assert.equal(q.subtotal, 2000000);
  assert.equal(q.tax, 200000);
  assert.equal(q.shippingFee, p.SHIPPING_FEE);
  assert.equal(q.total, 2000000 + 200000 + p.SHIPPING_FEE);
});

test('quote: free shipping above the threshold', () => {
  const q = p.computeQuote({ lines: [{ unitPrice: p.FREE_SHIPPING_THRESHOLD, quantity: 1 }] });
  assert.equal(q.shippingFee, 0);
});

test('quote: points are capped by balance and by the order total', () => {
  const lines = [{ unitPrice: 100000, quantity: 1 }];
  const byBalance = p.computeQuote({ lines, pointsRequested: 50, pointsAvailable: 20 });
  assert.equal(byBalance.pointsUsed, 20);
  assert.equal(byBalance.pointsDiscount, 20000);
  const byTotal = p.computeQuote({ lines, pointsRequested: 10000, pointsAvailable: 10000 });
  assert.equal(byTotal.total, 0);
  assert.equal(byTotal.pointsEarned, 0);
});

test('quote: discount is applied before tax', () => {
  const q = p.computeQuote({ lines: [{ unitPrice: 10000000, quantity: 1 }], discount: { type: 'percent', value: 10 } });
  assert.equal(q.discountAmount, 1000000);
  assert.equal(q.tax, 900000);
  assert.equal(q.total, 9900000);
  assert.equal(q.pointsEarned, 990);
});
