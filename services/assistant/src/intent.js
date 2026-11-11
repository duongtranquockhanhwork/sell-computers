// Understands shopping questions in Vietnamese or English: budget, product type,
// intended use, brand and store-policy questions. Pure functions, unit tested.

const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const CATEGORIES = [
  ['laptops', ['laptop', 'notebook', 'macbook', 'máy tính xách tay', 'xách tay', 'ultrabook']],
  ['desktop-pcs', ['desktop', 'pc', 'máy bộ', 'máy tính bàn', 'case', 'mini pc']],
  ['monitors', ['monitor', 'màn hình', 'display', 'screen']],
  ['graphics-cards', ['gpu', 'vga', 'card đồ họa', 'card màn hình', 'graphics card', 'rtx', 'radeon', 'geforce']],
  ['processors', ['cpu', 'processor', 'vi xử lý', 'chip', 'ryzen', 'core i']],
  ['memory', ['ram', 'memory', 'bộ nhớ', 'ddr4', 'ddr5']],
  ['storage', ['ssd', 'hdd', 'ổ cứng', 'storage', 'nvme', 'lưu trữ']],
  ['motherboards', ['motherboard', 'mainboard', 'bo mạch', 'main']],
  ['power-supplies', ['psu', 'power supply', 'nguồn', 'bộ nguồn']],
];

const USAGES = [
  ['gaming', ['gaming', 'game', 'chơi game', 'esports', 'fps']],
  ['office', ['office', 'văn phòng', 'work', 'làm việc', 'word', 'excel']],
  ['student', ['student', 'sinh viên', 'học sinh', 'học tập', 'study']],
  ['creator', ['design', 'đồ họa', 'thiết kế', 'edit video', 'dựng phim', 'render', 'photoshop', 'creator']],
  ['workstation', ['workstation', 'lập trình', 'coding', 'programming', 'máy ảo']],
  ['budget', ['rẻ', 'giá rẻ', 'cheap', 'budget', 'tiết kiệm', 'sinh viên']],
  ['premium', ['cao cấp', 'premium', 'mạnh nhất', 'best', 'flagship']],
];

const FAQ = [
  ['shipping', ['ship', 'giao hàng', 'vận chuyển', 'delivery', 'phí ship', 'shipping']],
  ['warranty', ['bảo hành', 'warranty', 'đổi trả', 'return', 'refund', 'hoàn tiền']],
  ['loyalty', ['điểm', 'points', 'loyalty', 'tích điểm', 'thành viên']],
  ['discount', ['mã giảm', 'discount', 'coupon', 'voucher', 'khuyến mãi', 'promo']],
  ['payment', ['thanh toán', 'payment', 'trả góp', 'cod', 'chuyển khoản', 'credit card', 'thẻ tín dụng']],
  ['tracking', ['theo dõi đơn', 'track', 'đơn hàng', 'order status', 'tình trạng đơn']],
];

const includesWord = (text, kw) => new RegExp(`(^|[^\\p{L}\\p{N}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u').test(text);

function detectLanguage(text) {
  return VI_CHARS.test(text) || /\b(tr|triệu|cho|mua|nao|gi)\b/i.test(text) ? 'vi' : 'en';
}

// "20 triệu", "20tr", "20m", "20 million", "15.5 triệu", "500k", "20.000.000"
function parseAmount(raw, unit) {
  const n = Number(String(raw).replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const u = (unit || '').toLowerCase();
  if (/^(tr|triệu|trieu|m|million|millions|mil)$/.test(u)) return Math.round(n * 1e6);
  if (/^(k|nghìn|ngàn|nghin)$/.test(u)) return Math.round(n * 1e3);
  if (n >= 100000) return Math.round(n);
  if (n > 0 && n < 1000) return Math.round(n * 1e6); // "dưới 20" in a shopping chat means millions
  return null;
}

function parseBudget(text) {
  const t = text.toLowerCase();
  const re = /(dưới|under|below|less than|tối đa|max|không quá|<=?|trên|over|above|more than|từ|from|khoảng|around|about|tầm|tầm khoảng|budget|ngân sách)?\s*(\d+(?:[.,]\d+)*)\s*(tr|triệu|trieu|m|million|millions|mil|k|nghìn|ngàn|nghin|đ|vnd|₫)?/giu;
  let m;
  let min = null;
  let max = null;
  while ((m = re.exec(t))) {
    const [, word, num, unit] = m;
    if (!word && !unit) continue; // plain numbers such as "4060" or "16GB" are not budgets
    if (unit && /^(gb|tb)$/.test(unit)) continue;
    const amount = parseAmount(num, unit);
    if (!amount) continue;
    const w = (word || '').trim();
    if (/^(trên|over|above|more than|từ|from)$/.test(w)) min = amount;
    else if (/^(khoảng|around|about|tầm|tầm khoảng)$/.test(w)) { min = Math.round(amount * 0.8); max = Math.round(amount * 1.15); }
    else max = amount;
  }
  return { minPrice: min, maxPrice: max };
}

function pick(list, text) {
  const found = list.find(([, kws]) => kws.some((kw) => includesWord(text, kw)));
  return found ? found[0] : null;
}

function parse(message, brands = []) {
  const text = String(message || '').toLowerCase().slice(0, 500);
  const budget = parseBudget(text);
  const brand = brands.find((b) => includesWord(text, b.toLowerCase())) || null;
  const category = pick(CATEGORIES, text);
  // Remove the product-type words ("card đồ họa") so they are not read as a use ("đồ họa").
  let rest = text;
  for (const [, kws] of CATEGORIES) for (const kw of kws) rest = rest.split(kw).join(' ');
  const usages = USAGES.filter(([, kws]) => kws.some((kw) => includesWord(rest, kw))).map(([u]) => u);
  // Model numbers and other specific words are kept for a keyword search ("rtx 4070", "990 pro").
  const model = (text.match(/\b(rtx|gtx|rx)\s?\d{4}\w*|\b\d{3,4}\s?(pro|evo|plus|ti|x3d)\b|\bi[3579]\b|\bryzen\s?[3579]\b/i) || [null])[0];
  return {
    language: detectLanguage(message),
    category,
    usages,
    brand,
    model,
    faq: pick(FAQ, rest),
    ...budget,
  };
}

module.exports = { parse, parseBudget, detectLanguage };
