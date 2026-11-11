import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useCart } from '../lib/cart';
import { useShopping } from '../lib/shopping';
import { vnd } from '../lib/format';

// Drawer that slides in after "Add to cart", like on most online stores.
export function MiniCart() {
  const { miniCartOpen, setMiniCartOpen, quote, count } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    setMiniCartOpen(false);
  }, [pathname, setMiniCartOpen]);
  if (!miniCartOpen) return null;
  const go = (to) => {
    setMiniCartOpen(false);
    navigate(to);
  };
  return (
    <>
      <div className="drawer-backdrop" onClick={() => setMiniCartOpen(false)} />
      <aside className="drawer" role="dialog" aria-label="Cart preview">
        <div className="d-flex align-items-center justify-content-between p-3 border-bottom">
          <h5 className="mb-0"><i className="bi bi-check-circle-fill text-success me-2" />Added to cart</h5>
          <button className="btn-close" onClick={() => setMiniCartOpen(false)} aria-label="Close" />
        </div>
        <div className="p-3 flex-grow-1 overflow-auto">
          {!quote && <div className="text-muted small">Updating...</div>}
          {quote?.lines.map((l) => (
            <div key={l.variantId} className="d-flex gap-2 mb-3">
              {l.image && <img src={l.image} alt="" className="rounded" width={64} height={48} style={{ objectFit: 'cover' }} />}
              <div className="small flex-grow-1 min-w-0">
                <div className="fw-semibold text-truncate">{l.productName}</div>
                <div className="text-muted">{l.variantName} × {l.quantity}</div>
              </div>
              <div className="small fw-semibold text-nowrap">{l.lineTotal ? vnd(l.lineTotal) : '-'}</div>
            </div>
          ))}
        </div>
        {quote && (
          <div className="p-3 border-top">
            <div className="d-flex justify-content-between mb-1"><span>{count} items · Subtotal</span><b>{vnd(quote.summary.subtotal)}</b></div>
            {quote.summary.shippingFee > 0 ? (
              <div className="small text-muted mb-3">Add {vnd(quote.freeShippingThreshold - quote.summary.subtotal)} more for free shipping</div>
            ) : <div className="small text-success mb-3"><i className="bi bi-truck me-1" />Free shipping unlocked</div>}
            <div className="d-grid gap-2">
              <button className="btn btn-primary" onClick={() => go('/checkout')}>Checkout</button>
              <button className="btn btn-outline-secondary" onClick={() => go('/cart')}>View cart</button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

// Bar listing the products selected for comparison.
export function CompareBar() {
  const { compare, removeCompare, clearCompare } = useShopping();
  const [items, setItems] = useState([]);
  const { pathname } = useLocation();
  useEffect(() => {
    if (!compare.length) return setItems([]);
    api.get(`/products/by-slugs?slugs=${compare.join(',')}`).then((r) => setItems(r.items)).catch(() => {});
  }, [compare]);
  if (!compare.length || pathname === '/compare' || pathname.startsWith('/admin')) return null;
  return (
    <div className="compare-bar shadow-lg">
      <div className="container d-flex align-items-center gap-2 flex-wrap py-2">
        <span className="fw-semibold small me-1"><i className="bi bi-arrow-left-right me-1" />Compare ({compare.length}/4)</span>
        {items.map((p) => (
          <span key={p.slug} className="compare-chip">
            <img src={p.image} alt="" />
            <span className="text-truncate">{p.name}</span>
            <button className="btn-close btn-close-sm" onClick={() => removeCompare(p.slug)} aria-label={`Remove ${p.name}`} />
          </span>
        ))}
        <div className="ms-auto d-flex gap-2">
          <button className="btn btn-sm btn-link text-white-50" onClick={clearCompare}>Clear</button>
          <Link to="/compare" className={`btn btn-sm btn-info ${compare.length < 2 ? 'disabled' : ''}`}>Compare now</Link>
        </div>
      </div>
    </div>
  );
}

// AI shopping assistant (assistant microservice).
function ChatWidget({ onClose }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Xin chào! Mình là trợ lý TechHaven. Hãy cho mình biết bạn cần gì, ví dụ: "laptop gaming dưới 30 triệu" hoặc "SSD 1TB giá rẻ".\nHi! Ask me in Vietnamese or English.', products: [] },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    const message = (text ?? draft).trim();
    if (message.length < 2 || busy) return;
    setDraft('');
    const history = messages.slice(1).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const r = await api.post('/assistant/chat', { message, history });
      setMessages((m) => [...m, { role: 'assistant', text: r.reply, products: r.products, engine: r.engine }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: err.message, products: [] }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-panel shadow-lg" role="dialog" aria-label="Shopping assistant">
      <div className="chat-head">
        <div><i className="bi bi-robot me-2" /><b>TechHaven Assistant</b><div className="small opacity-75">AI product advisor</div></div>
        <button className="btn-close btn-close-white" onClick={onClose} aria-label="Close chat" />
      </div>
      <div className="chat-body">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="bubble">{m.text}</div>
            {m.products?.length > 0 && (
              <div className="chat-products">
                {m.products.map((p) => (
                  <Link key={p.id} to={`/products/${p.slug}`} className="chat-product" onClick={onClose}>
                    <img src={p.image} alt="" />
                    <span className="min-w-0"><span className="d-block text-truncate fw-semibold">{p.name}</span><span className="text-danger">{vnd(p.price)}</span></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><div className="bubble"><span className="typing"><i /><i /><i /></span></div></div>}
        <div ref={end} />
      </div>
      <div className="chat-suggest">
        {['Laptop gaming dưới 30 triệu', 'Màn hình đồ họa', 'SSD 1TB giá rẻ', 'Phí giao hàng?'].map((q) => (
          <button key={q} className="btn btn-sm btn-outline-secondary" onClick={() => send(q)} disabled={busy}>{q}</button>
        ))}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="form-control" placeholder="Type your question..." value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} aria-label="Message" />
        <button className="btn btn-primary" disabled={busy || draft.trim().length < 2} aria-label="Send"><i className="bi bi-send" /></button>
      </form>
    </div>
  );
}

// Floating buttons: AI chat, hotline and back to top.
export function FloatingWidgets() {
  const [chat, setChat] = useState(false);
  const [top, setTop] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    const onScroll = () => setTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (pathname.startsWith('/admin')) return null;
  return (
    <>
      {chat && <ChatWidget onClose={() => setChat(false)} />}
      <div className="floating-stack">
        {top && <button className="fab fab-light" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top"><i className="bi bi-arrow-up" /></button>}
        <a className="fab fab-green" href="tel:19000000" aria-label="Call hotline 1900 0000" title="Hotline 1900 0000"><i className="bi bi-telephone" /></a>
        <button className="fab fab-blue" onClick={() => setChat((c) => !c)} aria-label="Open the shopping assistant" title="Ask our AI assistant">
          <i className={`bi ${chat ? 'bi-x-lg' : 'bi-chat-dots'}`} />
        </button>
      </div>
    </>
  );
}

// Full-screen image viewer for the product gallery.
export function Lightbox({ images, index, onIndex, onClose, alt }) {
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [index, images.length, onIndex, onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label="Image viewer" onClick={onClose}>
      <img src={images[index]} alt={alt} onClick={(e) => e.stopPropagation()} />
      {images.length > 1 && (
        <>
          <button className="gallery-nav prev" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }} aria-label="Previous image"><i className="bi bi-chevron-left" /></button>
          <button className="gallery-nav next" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }} aria-label="Next image"><i className="bi bi-chevron-right" /></button>
        </>
      )}
      <span className="gallery-count">{index + 1} / {images.length}</span>
      <button className="btn-close btn-close-white lightbox-close" onClick={onClose} aria-label="Close" />
    </div>
  );
}
