import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { vnd } from '../lib/format';
import { OrderInfo, OrderItems, OrderTotals } from '../components/OrderView';
import { Spinner, StatusBadge } from '../components/common';

export default function OrderSuccess() {
  const { number } = useParams();
  const location = useLocation();
  const { user, refresh } = useAuth();
  const [state, setState] = useState(() => {
    if (location.state?.order) return location.state;
    try {
      const saved = JSON.parse(sessionStorage.getItem('techhaven.lastOrder') || 'null');
      return saved?.order?.orderNumber === number ? saved : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    document.title = 'Order placed - TechHaven';
    refresh(); // loyalty balance changed
    if (!state && user) api.get(`/orders/${number}`).then((r) => setState({ order: r.order })).catch(() => {});
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) {
    return (
      <div className="container py-5 text-center">
        {user ? <Spinner /> : <p>Your order <b>{number}</b> was placed. Check your email for the details.</p>}
      </div>
    );
  }
  const { order, accountCreated } = state;
  return (
    <div className="container py-4" style={{ maxWidth: 900 }}>
      <div className="text-center mb-4">
        <div className="success-icon"><i className="bi bi-check-lg" /></div>
        <h1 className="h3 mt-3">Thank you! Your order has been placed.</h1>
        <p className="text-muted mb-1">Order <b>{order.orderNumber}</b> · <StatusBadge status={order.status} /></p>
        <p className="text-muted">A confirmation email has been sent to <b>{order.email}</b>.</p>
        {accountCreated && (
          <div className="alert alert-info text-start">
            <i className="bi bi-person-plus me-2" />We created a TechHaven account for <b>{order.email}</b>. Use the link in the email to set your password,
            then sign in to review this order and spend the <b>{order.pointsEarned}</b> points ({vnd(order.pointsEarned * 1000)}) you just earned.
          </div>
        )}
      </div>
      <div className="card mb-3"><div className="card-body"><OrderInfo order={order} /></div></div>
      <div className="row g-3">
        <div className="col-md-8"><div className="card"><div className="card-body"><OrderItems order={order} /></div></div></div>
        <div className="col-md-4"><div className="card"><div className="card-body"><OrderTotals order={order} /></div></div></div>
      </div>
      <div className="d-flex gap-2 justify-content-center mt-4">
        <Link to="/products" className="btn btn-primary">Continue shopping</Link>
        {user && <Link to={`/account/orders/${order.orderNumber}`} className="btn btn-outline-primary">Track this order</Link>}
      </div>
    </div>
  );
}
