// HTML e-mail templates. Each returns { subject, html, text }.
const SHOP = 'TechHaven';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '');

const vnd = (n) => `${Number(n || 0).toLocaleString('en-US')}₫`;
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { pending: 'Pending', confirmed: 'Confirmed', shipping: 'Shipping', delivered: 'Delivered', cancelled: 'Cancelled' };

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#0f172a;color:#fff;padding:18px 24px;font-size:20px;font-weight:700">Tech<span style="color:#38bdf8">Haven</span></td></tr>
    <tr><td style="padding:24px"><h2 style="margin:0 0 16px;font-size:20px">${esc(title)}</h2>${body}</td></tr>
    <tr><td style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px">${SHOP} - computers and computer components. This is an automated message.</td></tr>
  </table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0284c7;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;

function orderTable(o) {
  const rows = (o.items || []).map((i) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${esc(i.productName)}<br><span style="color:#6b7280;font-size:12px">${esc(i.variantName)} × ${i.quantity}</span></td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb">${vnd(i.lineTotal)}</td></tr>`).join('');
  const line = (label, value, bold) => `<tr><td style="padding:4px 0;${bold ? 'font-weight:700' : 'color:#4b5563'}">${label}</td><td align="right" style="padding:4px 0;${bold ? 'font-weight:700' : ''}">${value}</td></tr>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
    ${line('Subtotal', vnd(o.subtotal))}
    ${o.discountAmount ? line(`Discount${o.discountCode ? ` (${esc(o.discountCode)})` : ''}`, `-${vnd(o.discountAmount)}`) : ''}
    ${line('VAT (10%)', vnd(o.tax))}
    ${line('Shipping', o.shippingFee ? vnd(o.shippingFee) : 'Free')}
    ${o.pointsDiscount ? line(`Loyalty points (${o.pointsUsed})`, `-${vnd(o.pointsDiscount)}`) : ''}
    ${line('Total', vnd(o.total), true)}
  </table>`;
}

const templates = {
  'account-setup': ({ fullName, link }) => ({
    subject: `Welcome to ${SHOP} - set your password`,
    html: layout(`Welcome, ${fullName}!`, `<p>Your ${SHOP} account has been created. Choose a password to sign in, track orders and use your loyalty points.</p>
      ${button(link, 'Set my password')}<p style="color:#6b7280;font-size:13px">This link is valid for 72 hours and can be used once.</p>`),
    text: `Welcome to ${SHOP}, ${fullName}. Set your password: ${link}`,
  }),

  'password-reset': ({ fullName, link }) => ({
    subject: `${SHOP} password recovery`,
    html: layout('Reset your password', `<p>Hi ${esc(fullName)}, we received a request to reset your password.</p>
      ${button(link, 'Choose a new password')}<p style="color:#6b7280;font-size:13px">The link expires in 1 hour. If you did not request this, ignore this email.</p>`),
    text: `Reset your ${SHOP} password: ${link}`,
  }),

  'order-confirmation': ({ order: o, setupLink, accountCreated }) => ({
    subject: `${SHOP} order ${o.orderNumber} confirmed`,
    html: layout(`Thank you for your order, ${o.fullName}!`, `
      <p>Order <b>${esc(o.orderNumber)}</b> was placed on ${new Date(o.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}.</p>
      <p style="color:#4b5563">Ship to: ${esc(o.fullName)} · ${esc(o.phone)}<br>${esc(o.shippingAddress)}</p>
      ${orderTable(o)}
      <p>Payment: ${esc(o.paymentMethod === 'cod' ? 'Cash on delivery' : o.paymentMethod === 'card' ? 'Card' : 'Bank transfer')} (${esc(o.paymentStatus)})</p>
      <p>You earned <b>${o.pointsEarned} loyalty points</b> (${vnd(o.pointsEarned * 1000)}) for your next order.</p>
      ${accountCreated && setupLink ? `<p>We created an account for <b>${esc(o.email)}</b> so you can track this order.</p>${button(setupLink, 'Set a password and view my orders')}` : button(`${PUBLIC_URL}/account/orders/${o.orderNumber}`, 'Track my order')}`),
    text: `Order ${o.orderNumber} confirmed. Total ${vnd(o.total)}.`,
  }),

  'order-status': ({ order: o }) => ({
    subject: `${SHOP} order ${o.orderNumber} is now ${STATUS[o.status] || o.status}`,
    html: layout(`Your order is ${STATUS[o.status] || o.status}`, `
      <p>Order <b>${esc(o.orderNumber)}</b> changed status to <b>${esc(STATUS[o.status] || o.status)}</b>.</p>
      ${o.history && o.history[0] && o.history[0].note ? `<p style="color:#4b5563">${esc(o.history[0].note)}</p>` : ''}
      ${button(`${PUBLIC_URL}/account/orders/${o.orderNumber}`, 'View order')}`),
    text: `Order ${o.orderNumber} is now ${o.status}.`,
  }),
};

function render(name, data) {
  const t = templates[name];
  if (!t) throw new Error(`Unknown template ${name}`);
  return t(data || {});
}

module.exports = { render, templates };
