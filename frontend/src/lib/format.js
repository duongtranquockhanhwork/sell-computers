// "1 item", "2 items".
export const plural = (n, word) => `${Number(n).toLocaleString('en-US')} ${word}${Number(n) === 1 ? '' : 's'}`;

export const vnd = (n) => `${Math.round(Number(n || 0)).toLocaleString('en-US')}₫`;

export const date = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const dateTime = (d) =>
  new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const STATUS = {
  pending: { label: 'Pending', color: 'warning', icon: 'hourglass-split' },
  confirmed: { label: 'Confirmed', color: 'info', icon: 'check2-circle' },
  shipping: { label: 'Shipping', color: 'primary', icon: 'truck' },
  delivered: { label: 'Delivered', color: 'success', icon: 'box-seam' },
  cancelled: { label: 'Cancelled', color: 'secondary', icon: 'x-circle' },
};

export const PAYMENT = { cod: 'Cash on delivery', card: 'Credit / debit card', bank_transfer: 'Bank transfer' };

export const short = (n) => {
  const x = Number(n || 0);
  if (Math.abs(x) >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (Math.abs(x) >= 1e3) return `${(x / 1e3).toFixed(0)}K`;
  return String(x);
};
