// Shopping assistant. Products always come from the live catalogue (API), so the
// assistant never recommends something the shop does not sell. When
// GEMINI_API_KEY is set, Google Gemini writes the reply from those products.
// Without a key, or when Gemini fails, a template reply is used, so the
// feature always works.
const { GoogleGenAI, ApiError: GeminiApiError } = require('@google/genai');
const { parse } = require('./intent');

const API_URL = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' // fast enough for chat (about 4 s);

const vnd = (n, lang = 'en') => `${Number(n || 0).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')}₫`;

let brandsCache = { at: 0, list: [] };
async function brands() {
  if (Date.now() - brandsCache.at < 300000 && brandsCache.list.length) return brandsCache.list;
  try {
    const r = await fetch(`${API_URL}/api/brands`, { signal: AbortSignal.timeout(2000) });
    brandsCache = { at: Date.now(), list: (await r.json()).brands.map((b) => b.name) };
  } catch {
    /* keep the old list */
  }
  return brandsCache.list;
}

async function searchProducts(intent) {
  const tag = intent.usages.find((u) => ['gaming', 'office', 'student', 'creator', 'workstation', 'budget', 'premium'].includes(u));
  const base = { category: intent.category, brand: intent.brand, minPrice: intent.minPrice, maxPrice: intent.maxPrice, q: intent.model, inStock: 'true' };
  const sort = intent.usages.includes('budget') ? 'price_asc' : intent.usages.includes('premium') ? 'price_desc' : intent.model ? 'relevance' : 'rating';
  // Relax the filters step by step until something matches.
  const attempts = [{ ...base, tag }, base, { ...base, brand: null }, { ...base, brand: null, q: null }];
  for (const a of attempts) {
    const params = new URLSearchParams({ limit: '4', sort });
    for (const [k, v] of Object.entries(a)) if (v !== null && v !== undefined && v !== '') params.set(k, v);
    if (!params.get('q') && params.get('sort') === 'relevance') params.set('sort', 'rating');
    const r = await fetch(`${API_URL}/api/products?${params}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) continue;
    const data = await r.json();
    if (data.items.length) return data.items;
  }
  return [];
}

const FAQ_ANSWERS = {
  shipping: {
    vi: 'Phí giao hàng là 30.000₫ và miễn phí cho đơn từ 5.000.000₫. Đơn hàng được giao trên toàn quốc.',
    en: 'Shipping costs 30,000₫ and is free for orders from 5,000,000₫. We deliver nationwide.',
  },
  warranty: {
    vi: 'Mọi sản phẩm là hàng chính hãng, bảo hành theo hãng (đến 36 tháng) và được đổi trong 7 ngày nếu lỗi.',
    en: 'All products are genuine with the official manufacturer warranty (up to 36 months) and a 7-day exchange for defects.',
  },
  loyalty: {
    vi: 'Mỗi đơn hàng bạn nhận lại 10% giá trị dưới dạng điểm (1 điểm = 1.000₫) và có thể dùng ngay ở đơn tiếp theo.',
    en: 'Every order earns 10% of its total back as points (1 point = 1,000₫), usable immediately on your next order.',
  },
  discount: {
    vi: 'Nhập mã giảm giá gồm 5 ký tự ở giỏ hàng hoặc bước thanh toán; hệ thống sẽ cho biết mã còn hiệu lực và số tiền được giảm trước khi bạn thanh toán.',
    en: 'Enter a 5-character discount code in the cart or at checkout; you will see whether it is valid and how much it saves before paying.',
  },
  payment: {
    vi: 'Bạn có thể thanh toán khi nhận hàng (COD), bằng thẻ hoặc chuyển khoản. Không cần tạo tài khoản để mua hàng.',
    en: 'You can pay cash on delivery, by card or by bank transfer. No account is needed to buy.',
  },
  tracking: {
    vi: 'Bạn có thể tra cứu đơn tại trang "Track order" bằng mã đơn và email, hoặc xem lịch sử trạng thái trong mục Đơn hàng của tôi sau khi đăng nhập.',
    en: 'Track any order on the "Track order" page with its number and e-mail, or see the full status history under My orders after signing in.',
  },
};

function templateReply(intent, products, lang) {
  const vi = lang === 'vi';
  if (!products.length) {
    return vi
      ? 'Mình chưa tìm thấy sản phẩm phù hợp với yêu cầu này. Bạn thử nới ngân sách hoặc cho mình biết thêm nhu cầu sử dụng nhé.'
      : 'I could not find a matching product. Try a wider budget or tell me more about how you will use it.';
  }
  const parts = [];
  const { minPrice: lo, maxPrice: hi } = intent;
  if (lo && hi) parts.push(vi ? `trong khoảng ${vnd(lo, lang)} - ${vnd(hi, lang)}` : `between ${vnd(lo)} and ${vnd(hi)}`);
  else if (hi) parts.push(vi ? `dưới ${vnd(hi, lang)}` : `under ${vnd(hi)}`);
  else if (lo) parts.push(vi ? `từ ${vnd(lo, lang)}` : `from ${vnd(lo)}`);
  if (intent.usages.length) parts.push(vi ? `cho nhu cầu ${intent.usages.join(', ')}` : `for ${intent.usages.join(', ')}`);
  if (intent.brand) parts.push(vi ? `hãng ${intent.brand}` : `by ${intent.brand}`);
  const lead = vi
    ? `Đây là ${products.length} gợi ý${parts.length ? ` ${parts.join(', ')}` : ''}, sắp theo đánh giá và tình trạng còn hàng:`
    : `Here are ${products.length} suggestions${parts.length ? ` ${parts.join(', ')}` : ''}, ranked by rating and availability:`;
  const lines = products.map((p) => `• ${p.name} - ${vi ? 'từ' : 'from'} ${vnd(p.price, lang)}${p.discountPercent ? ` (-${p.discountPercent}%)` : ''}, ${p.avgRating.toFixed(1)}★`);
  return [lead, ...lines].join('\n');
}

const SYSTEM = `You are the shopping assistant of TechHaven, a Vietnamese online store that sells only computers and computer components.
Answer in the customer's language (Vietnamese or English), in at most 120 words, friendly and concrete.
Recommend only products from the CANDIDATES list, using their exact names and prices; never invent products, prices or stock.
If no candidate fits, say so and suggest how to refine the request. Mention store policies only when the customer asks about them, using only the POLICIES text.
Greet the customer only in your first reply of the conversation.
Write plain text without Markdown (the chat window does not render it); put each product on its own line starting with "• ".
Never ask for passwords, card numbers or other personal data.`;

// Conversation sent to Gemini: the last turns, then the grounded question.
function buildTurns(message, history, products, faqText, lang) {
  const candidates = products.map((p) => ({
    name: p.name, brand: p.brand, category: p.category.name, price: vnd(p.price, lang), originalPrice: p.compareAtPrice ? vnd(p.compareAtPrice, lang) : null,
    rating: p.avgRating, keySpecs: p.keySpecs, summary: p.shortDescription,
  }));
  const messages = [
    ...history.slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text).slice(0, 1000) })),
    {
      role: 'user',
      content: `CANDIDATES (JSON):\n${JSON.stringify(candidates)}\n\nPOLICIES:\n${Object.values(FAQ_ANSWERS).map((f) => f.en).join('\n')}\n${faqText ? `\nRELEVANT POLICY: ${faqText}` : ''}\n\nCUSTOMER: ${message}

${lang === 'vi' ? 'Reply in Vietnamese.' : 'Reply in English.'}`,
    },
  ];
  // The conversation must start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  return messages;
}

// Gemini uses role "model" for the assistant and a list of text parts.
const toGeminiContents = (turns) => turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] }));

async function geminiReply(turns) {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: toGeminiContents(turns),
    config: {
      systemInstruction: SYSTEM,
      maxOutputTokens: 1024, // short chat replies (about 120 words)
      abortSignal: AbortSignal.timeout(25000), // free tier latency varies; fall back to rules after 25 s
    },
  });
  // Remove Markdown emphasis in case the model still uses it.
  return response.text?.replace(/\*\*(.+?)\*\*/g, '$1').trim() || null;
}

// Follow-up questions ("Có mẫu nào rẻ hơn không?", "any cheaper one?") keep the
// product type, use, brand and budget of the customer's previous request.
function withContext(intent, history, brandList) {
  if (intent.category || intent.model) return intent;
  const prev = history.filter((h) => h.role === 'user').map((h) => parse(h.text, brandList)).reverse().find((p) => p.category || p.model);
  if (!prev) return intent;
  return {
    ...intent,
    category: prev.category,
    model: prev.model,
    brand: intent.brand || prev.brand,
    usages: [...new Set([...prev.usages, ...intent.usages])],
    minPrice: intent.minPrice ?? (intent.usages.includes('budget') ? null : prev.minPrice),
    maxPrice: intent.maxPrice ?? prev.maxPrice,
  };
}

async function chat(message, history = []) {
  const brandList = await brands();
  const intent = withContext(parse(message, brandList), history, brandList);
  const lang = intent.language;
  const wantsProducts = Boolean(intent.category || intent.model || intent.brand || intent.maxPrice || intent.minPrice || intent.usages.length) || !intent.faq;
  const faqText = intent.faq ? FAQ_ANSWERS[intent.faq][lang] : null;
  const products = wantsProducts ? await searchProducts(intent) : [];

  let reply = null;
  let engine = 'rules';
  if (gemini) {
    try {
      reply = await geminiReply(buildTurns(message, history, products, faqText, lang));
      if (reply) engine = 'gemini';
    } catch (err) {
      if (err instanceof GeminiApiError) {
        const why = err.status === 429 ? 'free-tier quota reached' : [400, 401, 403].includes(err.status) ? 'check GEMINI_API_KEY / GEMINI_MODEL' : 'API error';
        console.error(`[assistant] Gemini ${err.status} (${why}), using rules: ${err.message}`);
      } else console.error('[assistant] Gemini unavailable, using rules:', err.message);
    }
  }
  if (!reply) {
    reply = [faqText, wantsProducts ? templateReply(intent, products, lang) : null].filter(Boolean).join('\n\n');
  }
  return { reply, products, intent, engine };
}

module.exports = {
  chat, templateReply, buildTurns, withContext, toGeminiContents, FAQ_ANSWERS,
  provider: gemini ? 'gemini' : null, providerLabel: gemini ? `Gemini (${GEMINI_MODEL})` : null, llmEnabled: Boolean(gemini),
};
