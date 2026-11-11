const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/lib/http');

test('email is normalised and validated', () => {
  assert.equal(v.email('  An@Example.COM '), 'an@example.com');
  assert.throws(() => v.email('not-an-email'), { status: 400 });
});

test('phone accepts 9-15 digits with separators', () => {
  assert.equal(v.phone('090 123 4567'), '0901234567');
  assert.throws(() => v.phone('12ab'), { status: 400 });
  assert.equal(v.phone('', 'Phone', false), null);
});

test('password policy requires letters and digits', () => {
  assert.equal(v.password('Secret123'), 'Secret123');
  assert.throws(() => v.password('short1'), { status: 400 });
  assert.throws(() => v.password('onlyletters'), { status: 400 });
});

test('slugify handles Vietnamese characters', () => {
  assert.equal(v.slugify('Màn hình Đồ họa 27"'), 'man-hinh-do-hoa-27');
});

test('int enforces bounds and fallback', () => {
  assert.equal(v.int(undefined, { field: 'page', fallback: 1 }), 1);
  assert.throws(() => v.int('0', { field: 'page', min: 1 }), { status: 400 });
});
