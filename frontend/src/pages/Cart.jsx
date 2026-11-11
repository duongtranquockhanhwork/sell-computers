import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { plural, vnd } from '../lib/format';
import { EmptyState, Spinner } from '../components/common';

export function DiscountInput() {
  const { discountCode, setDiscountCode, quote } = useCart();
  const [draft, setDraft] = useState(discountCode);
  useEffect(() => {
    setDraft(discountCode);
  }, [discountCode]);
  const d = quote?.discount;
  return (
    <div className="mb-3">
      <label className="form-label small fw-semibold" htmlFor="discount">Discount code</label>
      <form className="input-group" onSubmit={(e) => { e.preventDefault(); setDiscountCode(draft.trim().toUpperCase()); }}>
        <input id="discount" className="form-control text-uppercase" maxLength={5} placeholder="5 characters" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} />
        {discountCode ? (
          <button type="button" className="btn btn-outline-secondary" onClick={() => { setDiscountCode(''); setDraft(''); }}>Remove</button>
        ) : (
          <button className="btn btn-outline-primary" disabled={draft.length !== 5}>Apply</button>
        )}
      </form>
      {d && (
        <div className={`small mt-1 ${d.valid ? 'text-success' : 'text-danger'}`}>
          <i className={`bi ${d.valid ? 'bi-check-circle' : 'bi-x-circle'} me-1`} />
          {d.valid ? `${d.code}: ${d.message} · ${d.remainingUses} use(s) left` : d.message}
        </div>
      )}
    </div>
  );
}

export function SummaryCard({ children, showDiscount = true }) {
  const { quote, quoting } = useCart();
  const s = quote?.summary;
  return (
    <div className="card summary-card">
      <div className="card-body">
        <h5 className="card-title d-flex justify-content-between">Order summary {quoting && <span className="spinner-border spinner-border-sm text-muted" />}</h5>
        {showDiscount && <DiscountInput />}
        {s && (
          <dl className="summary-list mb-3">
            <div><dt>Subtotal</dt><dd>{vnd(s.subtotal)}</dd></div>
            {s.discountAmount > 0 && <div className="text-success"><dt>Discount ({quote.discount.code})</dt><dd>-{vnd(s.discountAmount)}</dd></div>}
            <div><dt>VAT ({Math.round(quote.taxRate * 100)}%)</dt><dd>{vnd(s.tax)}</dd></div>
            <div><dt>Shipping</dt><dd>{s.shippingFee ? vnd(s.shippingFee) : <span className="text-success">Free</span>}</dd></div>
            {s.pointsDiscount > 0 && <div className="text-success"><dt>Loyalty points ({s.pointsUsed})</dt><dd>-{vnd(s.pointsDiscount)}</dd></div>}
            <div className="total"><dt>Total</dt><dd>{vnd(s.total)}</dd></div>
          </dl>
        )}
        {s && s.shippingFee > 0 && (
          <div className="small text-muted mb-3"><i className="bi bi-truck me-1" />Add {vnd(quote.freeShippingThreshold - s.subtotal)} more for free shipping.</div>
        )}
        {s && <div className="small text-muted mb-3"><i className="bi bi-gem me-1 text-info" />You will earn <b>{s.pointsEarned}</b> points ({vnd(s.pointsEarned * quote.pointValue)}) with this order.</div>}
        {children}
      </div>
    </div>
  );
}

export default function Cart() {
  const { items, quote, setQuantity, remove, clear } = useCart();
  const navigate = useNavigate();
  useEffect(() => { document.title = 'Shopping cart - TechHaven'; }, []);

  if (!items.length) {
    return (
      <div className="container py-5">
        <EmptyState icon="cart-x" title="Your cart is empty">
          <p>Browse our laptops, PCs and components to get started.</p>
          <Link to="/products" className="btn btn-primary">Continue shopping</Link>
        </EmptyState>
      </div>
    );
  }
  const lines = quote?.lines || [];
  const blocked = lines.some((l) => !l.available);

  return (
    <div className="container py-4">
      <h1 className="h3 mb-4">Shopping cart <span className="text-muted fs-6">({plural(items.reduce((s, i) => s + i.quantity, 0), 'item')})</span></h1>
      <div className="row g-4">
        <div className="col-lg-8">
          {!quote && <Spinner />}
          <div className="vstack gap-3">
            {lines.map((l) => (
              <div key={l.variantId} className={`card cart-line ${l.available ? '' : 'border-danger'}`}>
                <div className="card-body d-flex gap-3 align-items-center flex-wrap flex-md-nowrap">
                  {l.image && <Link to={`/products/${l.slug}`}><img src={l.image} alt="" className="cart-thumb" /></Link>}
                  <div className="flex-grow-1 min-w-0">
                    <Link to={`/products/${l.slug}`} className="fw-semibold text-body text-decoration-none">{l.productName || 'Unavailable item'}</Link>
                    <div className="small text-muted">{l.variantName}</div>
                    <div className="small">{vnd(l.unitPrice)} each</div>
                    {l.message && <div className="small text-danger"><i className="bi bi-exclamation-circle me-1" />{l.message}</div>}
                  </div>
                  <div className="input-group input-group-sm" style={{ width: 120 }}>
                    <button className="btn btn-outline-secondary" onClick={() => setQuantity(l.variantId, l.quantity - 1)} disabled={l.quantity <= 1} aria-label="Decrease"><i className="bi bi-dash" /></button>
                    <input className="form-control text-center" value={l.quantity} onChange={(e) => setQuantity(l.variantId, Number(e.target.value) || 1)} aria-label="Quantity" />
                    <button className="btn btn-outline-secondary" onClick={() => setQuantity(l.variantId, l.quantity + 1)} disabled={l.stock !== undefined && l.quantity >= l.stock} aria-label="Increase"><i className="bi bi-plus" /></button>
                  </div>
                  <div className="text-end fw-bold" style={{ minWidth: 120 }}>{l.lineTotal ? vnd(l.lineTotal) : '-'}</div>
                  <button className="btn btn-link text-danger" onClick={() => remove(l.variantId)} aria-label="Remove item"><i className="bi bi-trash" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="d-flex justify-content-between mt-3">
            <Link to="/products" className="btn btn-link"><i className="bi bi-arrow-left me-1" />Continue shopping</Link>
            <button className="btn btn-link text-danger" onClick={clear}>Clear cart</button>
          </div>
        </div>
        <div className="col-lg-4">
          <SummaryCard>
            <button className="btn btn-primary btn-lg w-100" disabled={!quote || blocked} onClick={() => navigate('/checkout')}>
              Proceed to checkout <i className="bi bi-arrow-right ms-1" />
            </button>
            {blocked && <div className="small text-danger mt-2">Remove or adjust unavailable items to continue.</div>}
          </SummaryCard>
        </div>
      </div>
    </div>
  );
}
