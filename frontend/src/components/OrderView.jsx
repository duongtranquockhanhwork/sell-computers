import { Link } from 'react-router-dom';
import { PAYMENT, STATUS, dateTime, vnd } from '../lib/format';
import { StatusBadge } from './common';

export function OrderItems({ order }) {
  return (
    // On phones the image and unit-price columns are hidden; the unit price is shown under the name.
    <div className="table-responsive">
    <table className="table align-middle mb-0">
      <thead className="small text-muted"><tr><th className="d-none d-sm-table-cell" /><th>Product</th><th className="text-end d-none d-sm-table-cell">Unit price</th><th className="text-center">Qty</th><th className="text-end">Total</th></tr></thead>
      <tbody>
        {order.items.map((i, idx) => (
          <tr key={idx}>
            <td className="d-none d-sm-table-cell" style={{ width: 64 }}>{i.image && <img src={i.image} alt="" width={56} className="rounded" />}</td>
            <td>
              {i.slug ? <Link to={`/products/${i.slug}`} className="fw-semibold text-body">{i.productName}</Link> : <span className="fw-semibold">{i.productName}</span>}
              <div className="small text-muted">{i.variantName}</div>
              <div className="small text-muted d-sm-none">{vnd(i.unitPrice)} each</div>
            </td>
            <td className="text-end d-none d-sm-table-cell">{vnd(i.unitPrice)}</td>
            <td className="text-center">{i.quantity}</td>
            <td className="text-end fw-semibold">{vnd(i.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function OrderTotals({ order }) {
  return (
    <dl className="summary-list mb-0">
      <div><dt>Subtotal</dt><dd>{vnd(order.subtotal)}</dd></div>
      {order.discountAmount > 0 && <div className="text-success"><dt>Discount {order.discountCode && `(${order.discountCode})`}</dt><dd>-{vnd(order.discountAmount)}</dd></div>}
      <div><dt>VAT</dt><dd>{vnd(order.tax)}</dd></div>
      <div><dt>Shipping</dt><dd>{order.shippingFee ? vnd(order.shippingFee) : 'Free'}</dd></div>
      {order.pointsDiscount > 0 && <div className="text-success"><dt>Points used ({order.pointsUsed})</dt><dd>-{vnd(order.pointsDiscount)}</dd></div>}
      <div className="total"><dt>Total</dt><dd>{vnd(order.total)}</dd></div>
      <div className="small text-info"><dt>Points earned</dt><dd>+{order.pointsEarned}</dd></div>
    </dl>
  );
}

// Status history, newest first.
export function OrderTimeline({ history }) {
  return (
    <table className="table table-sm mb-0">
      <thead className="small text-muted"><tr><th>Status</th><th>Updated at</th><th>Note</th></tr></thead>
      <tbody>
        {history.map((h, i) => (
          <tr key={i} className={i === 0 ? 'table-active' : ''}>
            <td><StatusBadge status={h.status} /></td>
            <td className="small text-nowrap">{dateTime(h.at)}</td>
            <td className="small text-muted">{h.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StatusProgress({ status }) {
  const flow = ['pending', 'confirmed', 'shipping', 'delivered'];
  if (status === 'cancelled') return <div className="alert alert-secondary py-2 mb-0"><i className="bi bi-x-circle me-2" />This order was cancelled.</div>;
  const idx = flow.indexOf(status);
  return (
    <div className="order-progress">
      {flow.map((s, i) => (
        <div key={s} className={`step ${i <= idx ? 'done' : ''}`}>
          <div className="dot"><i className={`bi bi-${STATUS[s].icon}`} /></div>
          <div className="small">{STATUS[s].label}</div>
        </div>
      ))}
    </div>
  );
}

export function OrderInfo({ order }) {
  return (
    <div className="row g-3 small">
      <div className="col-md-4">
        <div className="text-muted">Order number</div><div className="fw-semibold">{order.orderNumber}</div>
        <div className="text-muted mt-2">Placed at</div><div>{dateTime(order.createdAt)}</div>
      </div>
      <div className="col-md-4">
        <div className="text-muted">Ship to</div>
        <div className="fw-semibold">{order.fullName} · {order.phone}</div>
        <div>{order.shippingAddress}</div>
        <div className="text-muted">{order.email}</div>
      </div>
      <div className="col-md-4">
        <div className="text-muted">Payment</div>
        <div>{PAYMENT[order.paymentMethod]} <span className={`badge ${order.paymentStatus === 'paid' ? 'text-bg-success' : 'text-bg-warning'}`}>{order.paymentStatus}</span></div>
        {order.note && <><div className="text-muted mt-2">Note</div><div>{order.note}</div></>}
      </div>
    </div>
  );
}
