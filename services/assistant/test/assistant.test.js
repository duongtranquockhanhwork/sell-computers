const test = require('node:test');
const assert = require('node:assert/strict');
const { analyse } = require('../src/sentiment');
const { parse, parseBudget, detectLanguage } = require('../src/intent');

test('sentiment: English comments', () => {
  assert.equal(analyse('Great value for the price, I would buy again.').sentiment, 'positive');
  assert.equal(analyse('The fan is louder than I expected and the box was damaged. Disappointed.').sentiment, 'negative');
  assert.equal(analyse('Is there a version with more storage coming soon?').sentiment, 'neutral');
});

test('sentiment: Vietnamese comments with negation', () => {
  assert.equal(analyse('Sản phẩm chính hãng, giao hàng nhanh, rất hài lòng!').sentiment, 'positive');
  assert.equal(analyse('Máy bị lỗi sau một tuần, khá thất vọng.').sentiment, 'negative');
  assert.equal(analyse('Máy không tốt như quảng cáo').sentiment, 'negative');
});

test('budget parsing in both languages', () => {
  assert.deepEqual(parseBudget('laptop gaming dưới 25 triệu'), { minPrice: null, maxPrice: 25000000 });
  assert.deepEqual(parseBudget('a monitor under 8m'), { minPrice: null, maxPrice: 8000000 });
  assert.deepEqual(parseBudget('tầm 20tr'), { minPrice: 16000000, maxPrice: 23000000 });
  assert.deepEqual(parseBudget('rtx 4070 16GB'), { minPrice: null, maxPrice: null });
});

test('intent: category, usage, brand, model, FAQ and language', () => {
  const a = parse('Tư vấn laptop gaming hãng Lenovo dưới 40 triệu', ['Lenovo', 'ASUS']);
  assert.equal(a.category, 'laptops');
  assert.ok(a.usages.includes('gaming'));
  assert.equal(a.brand, 'Lenovo');
  assert.equal(a.maxPrice, 40000000);
  assert.equal(a.language, 'vi');
  const b = parse('Do you have an RTX 4070 graphics card?');
  assert.equal(b.category, 'graphics-cards');
  assert.match(b.model, /rtx\s?4070/i);
  assert.equal(b.language, 'en');
  assert.equal(parse('Phí giao hàng bao nhiêu?').faq, 'shipping');
  assert.equal(detectLanguage('cheap ssd please'), 'en');
});

test('intent: product words are not read as uses or policy questions', () => {
  const r = parse('card đồ họa rtx 4070');
  assert.equal(r.category, 'graphics-cards');
  assert.deepEqual(r.usages, []);
  assert.equal(r.faq, null);
});

test('LLM prompt: grounded turns and Gemini conversion', () => {
  const { buildTurns, toGeminiContents } = require('../src/chat');
  const products = [{ name: 'Laptop X', brand: 'ASUS', category: { name: 'Laptops' }, price: 20000000, compareAtPrice: null, avgRating: 4.5, keySpecs: [], shortDescription: 'Fast' }];
  const history = [{ role: 'assistant', text: 'Hello!' }, { role: 'user', text: 'laptop gaming' }, { role: 'assistant', text: 'Here are some' }];
  const turns = buildTurns('cheaper one?', history, products, null, 'en');
  assert.equal(turns[0].role, 'user'); // a leading assistant turn is dropped
  assert.ok(turns.at(-1).content.includes('"name":"Laptop X"') && turns.at(-1).content.includes('20,000,000₫'));
  const contents = toGeminiContents(turns);
  assert.deepEqual(contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(contents[1].parts[0].text, 'Here are some');
});

test('follow-up questions keep the previous request', () => {
  const { withContext } = require('../src/chat');
  const history = [{ role: 'user', text: 'Tư vấn laptop gaming dưới 30 triệu' }, { role: 'assistant', text: 'Đây là 2 gợi ý' }];
  const follow = withContext(parse('Có mẫu nào rẻ hơn không?'), history, []);
  assert.equal(follow.category, 'laptops');
  assert.ok(follow.usages.includes('gaming') && follow.usages.includes('budget'));
  assert.equal(follow.maxPrice, 30000000);
  // A new product type starts a new request.
  assert.equal(withContext(parse('màn hình văn phòng'), history, []).category, 'monitors');
});
