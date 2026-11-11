const test = require('node:test');
const assert = require('node:assert/strict');
const img = require('../src/lib/images');

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const jpg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
const gif = Buffer.from('474946383961010001000000', 'hex');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

test('image type is detected from the file signature', () => {
  assert.equal(img.detectImageType(png), 'image/png');
  assert.equal(img.detectImageType(jpg), 'image/jpeg');
  assert.equal(img.detectImageType(gif), 'image/gif');
  assert.equal(img.detectImageType(webp), 'image/webp');
  assert.equal(img.detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(img.detectImageType(Buffer.from('MZ executable....')), null);
});

test('a product needs between 1 and 10 images', () => {
  assert.match(img.validateImageList([]).error, /at least 1/);
  const ten = Array.from({ length: 10 }, (_, i) => `/api/media/${i + 1}`);
  assert.equal(img.validateImageList(ten).images.length, 10);
  assert.match(img.validateImageList([...ten, '/api/media/99']).error, /at most 10/);
});

test('duplicates are removed and only safe sources are accepted', () => {
  assert.deepEqual(img.validateImageList(['/api/media/1', ' /api/media/1 ']).images, ['/api/media/1']);
  assert.ok(img.validateImageList(['https://example.com/a.jpg']).images);
  assert.ok(img.validateImageList(['/api/media/gen/laptop/47/0.svg?t=X&b=Y']).images);
  assert.match(img.validateImageList(['http://example.com/a.jpg']).error, /https/);
  assert.match(img.validateImageList(['javascript:alert(1)']).error, /https/);
});
