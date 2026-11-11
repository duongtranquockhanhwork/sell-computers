// Pure pricing rules shared by the cart preview and checkout.
// Keeping them side-effect free makes them easy to unit test.

const TAX_RATE = 0.1;                    // 10% VAT on the discounted subtotal
const SHIPPING_FEE = 30000;              // flat fee in VND
const FREE_SHIPPING_THRESHOLD = 5000000; // free shipping from 5,000,000 VND
const POINT_VALUE = 1000;                // 1 loyalty point = 1,000 VND
const LOYALTY_RATE = 0.1;                // earn 10% of the order total

const DISCOUNT_CODE_PATTERN = /^[A-Z0-9]{5}$/;

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function isValidCodeFormat(code) {
  return DISCOUNT_CODE_PATTERN.test(normalizeCode(code));
}

// discount: { type: 'percent'|'fixed', value, usage_limit, used_count } or null
function discountAmount(subtotal, discount) {
  if (!discount) return 0;
  const raw = discount.type === 'percent'
    ? Math.round((subtotal * Number(discount.value)) / 100)
    : Number(discount.value);
  return Math.max(0, Math.min(subtotal, raw));
}

function pointsForTotal(total) {
  // 1,000,000 VND -> 100,000 VND worth of points -> 100 points.
  return Math.floor((total * LOYALTY_RATE) / POINT_VALUE);
}

/**
 * lines:          [{ unitPrice, quantity }]
 * discount:       active discount code row or null
 * pointsRequested number of points the customer wants to spend
 * pointsAvailable points on the customer's balance
 */
function computeQuote({ lines, discount = null, pointsRequested = 0, pointsAvailable = 0 }) {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discountValue = discountAmount(subtotal, discount);
  const taxable = subtotal - discountValue;
  const tax = Math.round(taxable * TAX_RATE);
  const shippingFee = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const beforePoints = taxable + tax + shippingFee;

  const wanted = Math.max(0, Math.floor(Number(pointsRequested) || 0));
  const maxByBalance = Math.max(0, Math.floor(Number(pointsAvailable) || 0));
  const maxByTotal = Math.floor(beforePoints / POINT_VALUE);
  const pointsUsed = Math.min(wanted, maxByBalance, maxByTotal);
  const pointsDiscount = pointsUsed * POINT_VALUE;

  const total = beforePoints - pointsDiscount;
  return {
    subtotal,
    discountAmount: discountValue,
    tax,
    shippingFee,
    pointsUsed,
    pointsDiscount,
    total,
    pointsEarned: pointsForTotal(total),
  };
}

module.exports = {
  TAX_RATE,
  SHIPPING_FEE,
  FREE_SHIPPING_THRESHOLD,
  POINT_VALUE,
  LOYALTY_RATE,
  normalizeCode,
  isValidCodeFormat,
  discountAmount,
  pointsForTotal,
  computeQuote,
};
