// Lexicon-based sentiment analysis for product comments in English and Vietnamese.
// English uses the AFINN-165 word list (npm "sentiment"); Vietnamese uses the
// phrase lexicon below, with simple negation handling ("không tốt" is negative).
const Sentiment = require('sentiment');

const english = new Sentiment();

// Weights follow the AFINN scale (-5 .. +5). Longer phrases are matched first.
const VI_LEXICON = {
  'tuyệt vời': 4, 'xuất sắc': 4, 'rất hài lòng': 4, 'quá đỉnh': 4, 'đáng tiền': 3, 'hài lòng': 3, 'yêu thích': 3,
  'chất lượng': 2, 'chính hãng': 2, 'nhiệt tình': 2, 'cẩn thận': 2, 'giá tốt': 2, 'mượt': 2, 'nhanh': 2,
  'tốt': 2, 'đẹp': 2, 'ổn định': 2, 'ủng hộ': 2, 'khuyên dùng': 3, 'recommend': 2, 'ổn': 1, 'tạm ổn': 0,
  'thất vọng': -4, 'tệ': -3, 'kém': -3, 'lỗi': -3, 'hỏng': -3, 'hư': -3, 'không nên mua': -4, 'lừa đảo': -5,
  'chậm': -2, 'đắt': -2, 'nóng': -2, 'ồn': -2, 'móp': -2, 'trầy': -2, 'giả': -3, 'bực': -3, 'tồi': -3,
};
const VI_PHRASES = Object.keys(VI_LEXICON).sort((a, b) => b.length - a.length);
const NEGATIONS = ['không', 'chẳng', 'chưa', 'đừng', 'chả'];

function vietnameseScore(text) {
  let s = ` ${text.toLowerCase().replace(/[.,!?;:()"]/g, ' ').replace(/\s+/g, ' ')} `;
  let score = 0;
  const hits = [];
  for (const phrase of VI_PHRASES) {
    const needle = ` ${phrase} `;
    let at = s.indexOf(needle);
    while (at !== -1) {
      const before = s.slice(Math.max(0, at - 12), at).trim().split(' ').pop();
      const negated = NEGATIONS.includes(before);
      const value = negated ? -VI_LEXICON[phrase] : VI_LEXICON[phrase];
      score += value;
      hits.push(negated ? `không ${phrase}` : phrase);
      // Blank the phrase so shorter phrases inside it are not counted twice.
      s = s.slice(0, at) + ' '.repeat(needle.length - 1) + s.slice(at + needle.length - 1);
      at = s.indexOf(needle);
    }
  }
  return { score, hits };
}

/** Returns { sentiment: 'positive'|'neutral'|'negative', score, words } */
function analyse(text) {
  const content = String(text || '').slice(0, 2000);
  const en = english.analyze(content);
  const vi = vietnameseScore(content);
  const score = en.score + vi.score;
  const words = [...en.positive, ...en.negative, ...vi.hits];
  const sentiment = score >= 1 ? 'positive' : score <= -1 ? 'negative' : 'neutral';
  return { sentiment, score, words };
}

module.exports = { analyse };
