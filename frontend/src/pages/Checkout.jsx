import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { PAYMENT, vnd } from '../lib/format';
import { ErrorAlert } from '../components/common';
import { SummaryCard } from './Cart';

const STEPS = ['Shipping', 'Payment', 'Review & confirm'];
const EMPTY_ADDRESS = { recipient: '', phone: '', addressLine: '', ward: '', district: '', city: '' };

export function AddressFields({ value, onChange, idPrefix = 'a' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="row g-2">
      <div className="col-md-6"><label className="form-label small" htmlFor={`${idPrefix}-r`}>Recipient name *</label><input id={`${idPrefix}-r`} className="form-control" required minLength={2} value={value.recipient} onChange={set('recipient')} /></div>
      <div className="col-md-6"><label className="form-label small" htmlFor={`${idPrefix}-p`}>Phone *</label><input id={`${idPrefix}-p`} className="form-control" required pattern="[0-9+ .\-]{9,18}" value={value.phone || ''} onChange={set('phone')} /></div>
      <div className="col-12"><label className="form-label small" htmlFor={`${idPrefix}-l`}>Street address *</label><input id={`${idPrefix}-l`} className="form-control" required minLength={3} value={value.addressLine} onChange={set('addressLine')} placeholder="House number, street" /></div>
      <div className="col-md-4"><label className="form-label small" htmlFor={`${idPrefix}-w`}>Ward</label><input id={`${idPrefix}-w`} className="form-control" value={value.ward || ''} onChange={set('ward')} /></div>
      <div className="col-md-4"><label className="form-label small" htmlFor={`${idPrefix}-d`}>District</label><input id={`${idPrefix}-d`} className="form-control" value={value.district || ''} onChange={set('district')} /></div>
      <div className="col-md-4"><label className="form-label small" htmlFor={`${idPrefix}-c`}>City / Province *</label><input id={`${idPrefix}-c`} className="form-control" required minLength={2} value={value.city} onChange={set('city')} /></div>
    </div>
  );
}

export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('new');
  const [guest, setGuest] = useState({ email: '', fullName: '' });
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(true);
  const [payment, setPayment] = useState('cod');
  const [card, setCard] = useState({ cardNumber: '', expiry: '', cvc: '', holder: '' });
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => { document.title = 'Checkout - TechHaven'; }, []);

  // Signed-in customers: pre-select their default address.
  useEffect(() => {
    if (!user) return;
    api.get('/profile/addresses').then(({ addresses: list }) => {
      setAddresses(list);
      const def = list.find((a) => a.isDefault) || list[0];
      setAddressId(def ? def.id : 'new');
      if (!def) setAddress({ ...EMPTY_ADDRESS, recipient: user.fullName, phone: user.phone || '' });
    }).catch(() => {});
  }, [user]);

  if (!cart.items.length) return <Navigate to="/cart" replace />;
  const q = cart.quote;
  const selected = addresses.find((a) => a.id === addressId);

  const next = (e) => {
    e.preventDefault();
    setError(null);
    if (step === 0 && selected && !selected.phone && !address.phone) return setError(new Error('Please add a phone number for delivery'));
    setStep((s) => s + 1);
    window.scrollTo(0, 0);
  };

  const place = async () => {
    setPlacing(true);
    setError(null);
    try {
      const shipping = user && selected
        ? { addressId: selected.id, phone: selected.phone || address.phone }
        : { ...address, email: guest.email, fullName: guest.fullName || address.recipient, saveAddress };
      const { order, accountCreated } = await api.post('/orders', {
        items: cart.items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        discountCode: q?.discount?.valid ? q.discount.code : undefined,
        pointsToUse: cart.pointsToUse,
        shipping,
        paymentMethod: payment,
        payment: payment === 'card' ? card : undefined,
        note: note || undefined,
      });
      cart.clear();
      try { sessionStorage.setItem('techhaven.lastOrder', JSON.stringify({ order, accountCreated })); } catch { /* ignore */ }
      navigate(`/order-success/${order.orderNumber}`, { state: { order, accountCreated }, replace: true });
    } catch (err) {
      setError(err);
      cart.refreshQuote();
    } finally {
      setPlacing(false);
    }
  };

  const shipTo = user && selected ? selected : { ...address, formatted: [address.addressLine, address.ward, address.district, address.city].filter(Boolean).join(', ') };

  return (
    <div className="container py-4">
      <h1 className="h3 mb-3">Checkout</h1>
      <ol className="stepper mb-4">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'active' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step} onClick={() => i < step && setStep(i)}>
              <span className="num">{i < step ? <i className="bi bi-check" /> : i + 1}</span>{label}
            </button>
          </li>
        ))}
      </ol>
      <div className="row g-4">
        <div className="col-lg-8">
          <ErrorAlert error={error} />
          {step === 0 && (
            <form className="card card-body" onSubmit={next}>
              <h5 className="mb-3"><i className="bi bi-geo-alt me-2" />Shipping details</h5>
              {!user && (
                <>
                  <div className="alert alert-info small">
                    Checking out as a guest. <Link to="/login?redirect=/checkout">Sign in</Link> to use saved addresses and loyalty points.
                    We will create an account for your email so you can track this order later.
                  </div>
                  <div className="row g-2 mb-3">
                    <div className="col-md-6"><label className="form-label small" htmlFor="g-email">Email *</label><input id="g-email" type="email" required className="form-control" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></div>
                    <div className="col-md-6"><label className="form-label small" htmlFor="g-name">Full name *</label><input id="g-name" required minLength={2} className="form-control" value={guest.fullName} onChange={(e) => { setGuest({ ...guest, fullName: e.target.value }); if (!address.recipient || address.recipient === guest.fullName) setAddress({ ...address, recipient: e.target.value }); }} /></div>
                  </div>
                </>
              )}
              {user && addresses.length > 0 && (
                <div className="vstack gap-2 mb-3">
                  {addresses.map((a) => (
                    <label key={a.id} className={`address-option ${addressId === a.id ? 'active' : ''}`}>
                      <input type="radio" className="form-check-input me-2" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                      <span>
                        <b>{a.recipient}</b> {a.phone && <span className="text-muted">· {a.phone}</span>} {a.isDefault && <span className="badge text-bg-primary ms-1">Default</span>}
                        <div className="small text-muted">{a.formatted}</div>
                      </span>
                    </label>
                  ))}
                  <label className={`address-option ${addressId === 'new' ? 'active' : ''}`}>
                    <input type="radio" className="form-check-input me-2" name="addr" checked={addressId === 'new'} onChange={() => { setAddressId('new'); if (!address.recipient) setAddress({ ...EMPTY_ADDRESS, recipient: user.fullName, phone: user.phone || '' }); }} />
                    <span><i className="bi bi-plus-circle me-1" />Ship to a different address</span>
                  </label>
                </div>
              )}
              {selected && !selected.phone && (
                <div className="mb-3"><label className="form-label small" htmlFor="ph">Phone for this delivery *</label><input id="ph" className="form-control" required value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} /></div>
              )}
              {(!user || addressId === 'new') && (
                <>
                  <AddressFields value={address} onChange={setAddress} />
                  {user && (
                    <div className="form-check mt-2">
                      <input className="form-check-input" type="checkbox" id="save-addr" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="save-addr">Save this address to my address book</label>
                    </div>
                  )}
                </>
              )}
              <div className="mt-3"><label className="form-label small" htmlFor="note">Order note (optional)</label><input id="note" maxLength={300} className="form-control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. call before delivery" /></div>
              <div className="d-flex justify-content-between mt-4">
                <Link to="/cart" className="btn btn-link"><i className="bi bi-arrow-left me-1" />Back to cart</Link>
                <button className="btn btn-primary">Continue to payment</button>
              </div>
            </form>
          )}

          {step === 1 && (
            <form className="card card-body" onSubmit={next}>
              <h5 className="mb-3"><i className="bi bi-credit-card me-2" />Payment method</h5>
              <div className="vstack gap-2 mb-3">
                {Object.entries(PAYMENT).map(([k, label]) => (
                  <label key={k} className={`address-option ${payment === k ? 'active' : ''}`}>
                    <input type="radio" className="form-check-input me-2" name="pay" checked={payment === k} onChange={() => setPayment(k)} />
                    <span>
                      <b>{label}</b>
                      <div className="small text-muted">
                        {k === 'cod' && 'Pay in cash when the order is delivered.'}
                        {k === 'card' && 'Demo payment gateway - no real charge is made.'}
                        {k === 'bank_transfer' && 'Transfer to TechHaven account 0123 456 789 (demo, confirmed instantly).'}
                      </div>
                    </span>
                  </label>
                ))}
              </div>
              {payment === 'card' && (
                <div className="row g-2 mb-3">
                  <div className="col-12 small text-muted">Test cards: 4242 4242 4242 4242 (approved), 4000 0000 0000 0002 (declined). Card details are not stored.</div>
                  <div className="col-12"><label className="form-label small" htmlFor="cn">Card number</label><input id="cn" className="form-control" inputMode="numeric" autoComplete="off" required value={card.cardNumber} onChange={(e) => setCard({ ...card, cardNumber: e.target.value.replace(/[^0-9 ]/g, '') })} placeholder="4242 4242 4242 4242" /></div>
                  <div className="col-6"><label className="form-label small" htmlFor="ce">Expiry (MM/YY)</label><input id="ce" className="form-control" required pattern="(0[1-9]|1[0-2])/[0-9]{2}" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} placeholder="12/28" /></div>
                  <div className="col-6"><label className="form-label small" htmlFor="cc">CVC</label><input id="cc" className="form-control" required pattern="[0-9]{3,4}" autoComplete="off" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} /></div>
                </div>
              )}
              {user ? (
                <div className="card bg-light border-0 mb-3">
                  <div className="card-body">
                    <h6><i className="bi bi-gem me-2 text-info" />Loyalty points</h6>
                    <div className="small mb-2">You have <b>{q?.pointsAvailable ?? user.loyaltyPoints}</b> points (1 point = {vnd(1000)}).</div>
                    <div className="d-flex gap-2 align-items-center">
                      <input type="range" className="form-range" min={0} max={q?.pointsAvailable ?? 0} value={cart.pointsToUse} onChange={(e) => cart.setPointsToUse(Number(e.target.value))} aria-label="Points to use" />
                      <input type="number" className="form-control form-control-sm" style={{ width: 100 }} min={0} max={q?.pointsAvailable ?? 0} value={cart.pointsToUse} onChange={(e) => cart.setPointsToUse(Math.max(0, Number(e.target.value) || 0))} />
                      <button type="button" className="btn btn-sm btn-outline-primary text-nowrap" onClick={() => cart.setPointsToUse(q?.pointsAvailable ?? 0)}>Use max</button>
                    </div>
                    {q?.summary.pointsUsed > 0 && <div className="small text-success mt-1">Using {q.summary.pointsUsed} points: -{vnd(q.summary.pointsDiscount)}</div>}
                  </div>
                </div>
              ) : (
                <div className="small text-muted mb-3"><i className="bi bi-info-circle me-1" />Guests earn points on this order and can spend them after signing in.</div>
              )}
              <div className="d-flex justify-content-between">
                <button type="button" className="btn btn-link" onClick={() => setStep(0)}><i className="bi bi-arrow-left me-1" />Shipping</button>
                <button className="btn btn-primary">Review order</button>
              </div>
            </form>
          )}

          {step === 2 && q && (
            <div className="card card-body">
              <h5 className="mb-3"><i className="bi bi-clipboard-check me-2" />Review your order</h5>
              <div className="row g-3 mb-3 small">
                <div className="col-md-6">
                  <div className="fw-semibold">Ship to</div>
                  <div>{shipTo.recipient} · {shipTo.phone || address.phone}</div>
                  <div className="text-muted">{shipTo.formatted}</div>
                  {!user && <div className="text-muted">Confirmation to {guest.email}</div>}
                </div>
                <div className="col-md-6">
                  <div className="fw-semibold">Payment</div>
                  <div>{PAYMENT[payment]}{payment === 'card' && card.cardNumber && ` ending ${card.cardNumber.replace(/\s/g, '').slice(-4)}`}</div>
                  {note && <div className="text-muted">Note: {note}</div>}
                </div>
              </div>
              <table className="table align-middle">
                <tbody>
                  {q.lines.map((l) => (
                    <tr key={l.variantId}>
                      <td style={{ width: 60 }}>{l.image && <img src={l.image} alt="" className="rounded" width={56} />}</td>
                      <td><div className="fw-semibold">{l.productName}</div><div className="small text-muted">{l.variantName} × {l.quantity}</div>{l.message && <div className="small text-danger">{l.message}</div>}</td>
                      <td className="text-end">{vnd(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="d-flex justify-content-between align-items-center">
                <button type="button" className="btn btn-link" onClick={() => setStep(1)}><i className="bi bi-arrow-left me-1" />Payment</button>
                <button className="btn btn-success btn-lg" disabled={placing || q.lines.some((l) => !l.available)} onClick={place}>
                  {placing ? <><span className="spinner-border spinner-border-sm me-2" />Placing order...</> : <>Place order · {vnd(q.summary.total)}</>}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="col-lg-4">
          <SummaryCard showDiscount={step < 2} />
        </div>
      </div>
    </div>
  );
}
