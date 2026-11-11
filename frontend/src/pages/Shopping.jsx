import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageMeta } from '../lib/seo';
import { MAX_COMPARE, useShopping } from '../lib/shopping';
import { vnd } from '../lib/format';
import { EmptyState, ErrorAlert, PagedProducts, PriceTag, Spinner, Stars } from '../components/common';
import { OrderInfo, OrderItems, OrderTimeline, OrderTotals, StatusProgress } from '../components/OrderView';

// ---------- Compare up to four products side by side ----------
export function Compare() {
  const { compare, removeCompare, clearCompare } = useShopping();
  const [items, setItems] = useState(null);
  const [onlyDiff, setOnlyDiff] = useState(false);
  usePageMeta({ title: 'Compare products' });

  useEffect(() => {
    if (!compare.length) {
      setItems([]);
      return;
    }
    api.get(`/products/by-slugs?slugs=${compare.join(',')}`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [compare]);

  if (!items) return <Spinner />;
  if (!items.length) {
    return (
      <div className="container py-5">
        <EmptyState icon="arrow-left-right" title="Nothing to compare yet">
          <p>Use the <i className="bi bi-arrow-left-right" /> button on up to {MAX_COMPARE} products to compare their specifications side by side.</p>
          <Link to="/products" className="btn btn-primary">Browse products</Link>
        </EmptyState>
      </div>
    );
  }
  const specKeys = [...new Set(items.flatMap((p) => Object.keys(p.specs || {})))];
  const rows = [
    ['Price', (p) => <PriceTag price={p.price} compareAt={p.compareAtPrice} discount={p.discountPercent} from={p.variantCount > 1} />, (p) => p.price],
    ['Brand', (p) => p.brand, (p) => p.brand],
    ['Category', (p) => p.category.name, (p) => p.category.name],
    ['Rating', (p) => <span><Stars value={p.avgRating} size=".8rem" /> {p.avgRating.toFixed(1)} ({p.ratingCount})</span>, (p) => p.avgRating],
    ['Sold', (p) => p.soldCount, (p) => p.soldCount],
    ['Availability', (p) => (p.inStock ? <span className="text-success">In stock</span> : <span className="text-danger">Out of stock</span>), (p) => p.inStock],
    ...specKeys.map((k) => [k, (p) => p.specs?.[k] ?? '-', (p) => p.specs?.[k] ?? '-']),
  ];
  const visible = onlyDiff ? rows.filter(([, , val]) => new Set(items.map((p) => String(val(p)))).size > 1) : rows;

  return (
    <div className="container py-4">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="h3 mb-0">Compare products</h1>
        <div className="form-check form-switch ms-md-3">
          <input className="form-check-input" type="checkbox" id="diff" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          <label className="form-check-label small" htmlFor="diff">Show differences only</label>
        </div>
        <button className="btn btn-sm btn-outline-danger ms-auto" onClick={clearCompare}>Clear all</button>
      </div>
      <div className="table-responsive card">
        <table className="table compare-table align-middle mb-0">
          <thead>
            <tr>
              <th style={{ width: 170 }} />
              {items.map((p) => (
                <th key={p.slug} className="text-center">
                  <button className="btn-close float-end" onClick={() => removeCompare(p.slug)} aria-label={`Remove ${p.name}`} />
                  <Link to={`/products/${p.slug}`}><img src={p.image} alt="" className="rounded mb-2" /></Link>
                  <Link to={`/products/${p.slug}`} className="d-block fw-semibold text-body small">{p.name}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(([label, render]) => (
              <tr key={label}><th className="small text-muted">{label}</th>{items.map((p) => <td key={p.slug} className="small text-center">{render(p)}</td>)}</tr>
            ))}
            <tr><th />{items.map((p) => <td key={p.slug} className="text-center"><Link to={`/products/${p.slug}`} className="btn btn-sm btn-primary">Choose variant</Link></td>)}</tr>
          </tbody>
        </table>
      </div>
      {items.length < MAX_COMPARE && <p className="small text-muted mt-2">You can add {MAX_COMPARE - items.length} more product{MAX_COMPARE - items.length > 1 ? 's' : ''}.</p>}
    </div>
  );
}

// ---------- Wish list (account or browser) ----------
export function Wishlist() {
  const { user } = useAuth();
  const { wishIds, guestWish } = useShopping();
  const [items, setItems] = useState(null);
  usePageMeta({ title: 'My wish list' });

  useEffect(() => {
    const load = user
      ? api.get('/wishlist?limit=48').then((r) => r.items)
      : guestWish.length ? api.get(`/products/by-slugs?slugs=${guestWish.map((x) => x.slug).join(',')}`).then((r) => r.items) : Promise.resolve([]);
    load.then(setItems).catch(() => setItems([]));
  }, [user, wishIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container py-4">
      <h1 className="h3 mb-1"><i className="bi bi-heart me-2 text-danger" />My wish list</h1>
      <p className="text-muted small">{user ? 'Saved to your account.' : <>Saved in this browser. <Link to="/login?redirect=/wishlist">Sign in</Link> to keep it in your account.</>}</p>
      {!items ? <Spinner /> : (
        <PagedProducts items={items} perPage={8} cols="col-6 col-md-4 col-lg-3"
          empty={<EmptyState icon="heart" title="Your wish list is empty"><p>Tap the heart on any product to save it for later.</p><Link to="/products" className="btn btn-primary">Browse products</Link></EmptyState>} />
      )}
    </div>
  );
}

// ---------- Order tracking without signing in ----------
export function TrackOrder() {
  const [form, setForm] = useState({ orderNumber: '', email: '' });
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  usePageMeta({ title: 'Track your order' });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setOrder((await api.post('/orders/lookup', form)).order);
    } catch (err) {
      setOrder(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <h1 className="h3 mb-1"><i className="bi bi-truck me-2 text-primary" />Track your order</h1>
      <p className="text-muted small">Enter the order number from your confirmation e-mail and the e-mail address used at checkout. No account needed.</p>
      <form className="card card-body mb-4" onSubmit={submit}>
        <div className="row g-2 align-items-end">
          <div className="col-md-5"><label className="form-label small" htmlFor="on">Order number</label><input id="on" className="form-control text-uppercase" required placeholder="TH2611..." value={form.orderNumber} onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} /></div>
          <div className="col-md-5"><label className="form-label small" htmlFor="oe">E-mail</label><input id="oe" type="email" className="form-control" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="col-md-2"><button className="btn btn-primary w-100" disabled={busy}>{busy ? 'Searching...' : 'Track'}</button></div>
        </div>
      </form>
      <ErrorAlert error={error} />
      {order && (
        <>
          <div className="card mb-3"><div className="card-body"><StatusProgress status={order.status} /></div></div>
          <div className="card mb-3"><div className="card-body"><OrderInfo order={order} /></div></div>
          <div className="row g-3">
            <div className="col-lg-8">
              <div className="card mb-3"><div className="card-body"><OrderItems order={order} /></div></div>
              <div className="card"><div className="card-header bg-white fw-semibold">Status history</div><div className="card-body"><OrderTimeline history={order.history} /></div></div>
            </div>
            <div className="col-lg-4"><div className="card"><div className="card-body"><OrderTotals order={order} /></div></div></div>
          </div>
          <p className="small text-muted mt-3">Total paid: {vnd(order.total)}. Sign in with {order.email} to see all your orders.</p>
        </>
      )}
    </div>
  );
}
