import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { dateTime, vnd } from '../lib/format';
import { getSocket } from '../lib/socket';
import { useToast } from '../lib/toast';
import { EmptyState, ErrorAlert, PagedProducts, Pagination, Spinner, Stars } from '../components/common';
import { Lightbox } from '../components/Widgets';
import { usePageMeta } from '../lib/seo';
import { recentlyViewed, recordRecentlyViewed, useShopping } from '../lib/shopping';

const SENTIMENT = {
  positive: ['success', 'emoji-smile', 'Positive'],
  neutral: ['secondary', 'emoji-neutral', 'Neutral'],
  negative: ['danger', 'emoji-frown', 'Negative'],
};
function SentimentBadge({ value }) {
  const [color, icon, label] = SENTIMENT[value];
  return <span className={`badge rounded-pill text-bg-${color}`} title="Detected by our AI sentiment analysis"><i className={`bi bi-${icon} me-1`} />{label}</span>;
}

function SentimentSummary({ s }) {
  if (!s || !s.analysed) return null;
  const pct = (n) => Math.round((n / s.analysed) * 100);
  return (
    <div className="mt-3 pt-3 border-top">
      <div className="small fw-semibold mb-1"><i className="bi bi-robot me-1" />What buyers say (AI sentiment, {s.analysed} comments)</div>
      <div className="progress" style={{ height: 10 }} role="img" aria-label={`${pct(s.positive)}% positive, ${pct(s.neutral)}% neutral, ${pct(s.negative)}% negative`}>
        <div className="progress-bar bg-success" style={{ width: `${pct(s.positive)}%` }} />
        <div className="progress-bar bg-secondary" style={{ width: `${pct(s.neutral)}%` }} />
        <div className="progress-bar bg-danger" style={{ width: `${pct(s.negative)}%` }} />
      </div>
      <div className="d-flex justify-content-between small text-muted mt-1">
        <span className="text-success">{pct(s.positive)}% positive</span><span>{pct(s.neutral)}% neutral</span><span className="text-danger">{pct(s.negative)}% negative</span>
      </div>
    </div>
  );
}

function RatingPanel({ product, rating, setRating }) {
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(false);

  const rate = async (stars) => {
    setSaving(true);
    try {
      const r = await api.put(`/products/${product.id}/rating`, { stars });
      setRating(r.rating);
      toast(`Thanks! You rated this product ${stars} star${stars > 1 ? 's' : ''}.`);
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const max = Math.max(1, ...Object.values(rating.distribution));
  return (
    <div className="card h-100">
      <div className="card-body">
        <div className="d-flex align-items-center gap-3 mb-3">
          <div className="display-5 fw-bold">{rating.average.toFixed(1)}</div>
          <div>
            <Stars value={rating.average} size="1.2rem" />
            <div className="small text-muted">{rating.count} ratings</div>
          </div>
        </div>
        {[5, 4, 3, 2, 1].map((s) => (
          <div key={s} className="d-flex align-items-center gap-2 small mb-1">
            <span style={{ width: 28 }}>{s} <i className="bi bi-star-fill text-warning" /></span>
            <div className="progress flex-grow-1" style={{ height: 8 }}>
              <div className="progress-bar bg-warning" style={{ width: `${(rating.distribution[s] / max) * 100}%` }} />
            </div>
            <span className="text-muted" style={{ width: 24 }}>{rating.distribution[s]}</span>
          </div>
        ))}
        <hr />
        {user ? (
          <div>
            <div className="small fw-semibold mb-1">{rating.mine ? 'Your rating (click to change)' : 'Rate this product'}</div>
            <div className="star-input" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" disabled={saving} className="btn btn-link p-0 me-1" onMouseEnter={() => setHover(s)} onClick={() => rate(s)} aria-label={`${s} stars`}>
                  <i className={`bi ${(hover || rating.mine || 0) >= s ? 'bi-star-fill' : 'bi-star'} fs-4 text-warning`} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="small text-muted">
            <Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`}>Sign in</Link> to rate this product with stars. Anyone can leave a comment.
          </div>
        )}
        <SentimentSummary s={product.sentiment} />
      </div>
    </div>
  );
}

function Comments({ product }) {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ authorName: '', content: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get(`/products/${product.id}/comments?page=${page}`).then(setData).catch(setError);
  }, [product.id, page]);
  useEffect(load, [load]);

  // Live updates pushed by the realtime service.
  useEffect(() => {
    const s = getSocket();
    const join = () => s.emit('product:join', product.id);
    join();
    s.on('connect', join);
    const onComment = (c) => {
      setData((d) => {
        if (!d || page !== 1 || d.items.some((x) => x.id === c.id)) return d;
        return { ...d, items: [c, ...d.items].slice(0, 10), total: d.total + 1, totalPages: Math.max(1, Math.ceil((d.total + 1) / 10)) };
      });
    };
    s.on('comment:new', onComment);
    // The assistant service classifies each comment a moment after it is posted.
    const onSentiment = ({ id, sentiment }) => setData((d) => d && { ...d, items: d.items.map((x) => (x.id === id ? { ...x, sentiment } : x)) });
    s.on('comment:sentiment', onSentiment);
    return () => {
      s.emit('product:leave', product.id);
      s.off('connect', join);
      s.off('comment:new', onComment);
      s.off('comment:sentiment', onSentiment);
    };
  }, [product.id, page]);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const { comment } = await api.post(`/products/${product.id}/comments`, form);
      setForm({ ...form, content: '' });
      setData((d) => (d && !d.items.some((x) => x.id === comment.id) ? { ...d, items: [comment, ...d.items].slice(0, 10), total: d.total + 1 } : d));
      toast('Your comment was posted');
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <form onSubmit={submit} className="card card-body mb-3">
        <h6 className="mb-3">Leave a comment</h6>
        <ErrorAlert error={error} />
        {!user && (
          <input className="form-control mb-2" placeholder="Your name" required minLength={2} maxLength={80} value={form.authorName} onChange={(e) => setForm({ ...form, authorName: e.target.value })} />
        )}
        <textarea className="form-control mb-2" rows={3} placeholder="Share your experience or ask a question..." required minLength={2} maxLength={2000} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        <div className="d-flex justify-content-between align-items-center">
          <span className="small text-muted">{user ? `Posting as ${user.fullName}` : 'No account needed to comment'}</span>
          <button className="btn btn-primary" disabled={sending}>{sending ? 'Posting...' : 'Post comment'}</button>
        </div>
      </form>
      {!data && <Spinner />}
      {data && data.items.length === 0 && <EmptyState icon="chat-dots" title="No comments yet">Be the first to share your thoughts.</EmptyState>}
      {data && data.items.map((c) => (
        <div key={c.id} className="comment">
          <div className="avatar">{c.authorName.slice(0, 1).toUpperCase()}</div>
          <div className="flex-grow-1">
            <div className="d-flex flex-wrap align-items-center gap-2">
              <strong>{c.authorName}</strong>
              {c.isMember ? <span className="badge text-bg-light">Member</span> : <span className="badge text-bg-light">Guest</span>}
              {c.stars && <Stars value={c.stars} size=".8rem" />}
              {c.sentiment && <SentimentBadge value={c.sentiment} />}
              <span className="small text-muted ms-auto">{dateTime(c.createdAt)}</span>
            </div>
            <div className="mt-1" style={{ whiteSpace: 'pre-line' }}>{c.content}</div>
          </div>
        </div>
      ))}
      {data && data.total > 10 && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </div>
  );
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { add } = useCart();
  const navigate = useNavigate();
  const shop = useShopping();
  const [zoom, setZoom] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [variantId, setVariantId] = useState(null);
  const [image, setImage] = useState(0);
  const [qty, setQty] = useState(1);
  const [rating, setRating] = useState(null);
  const [tab, setTab] = useState('description');

  useEffect(() => {
    setData(null);
    setError(null);
    setImage(0);
    setQty(1);
    api.get(`/products/${slug}`).then((d) => {
      setData(d);
      setRating(d.product.rating);
      const firstAvailable = d.product.variants.find((v) => v.stock > 0) || d.product.variants[0];
      setVariantId(firstAvailable?.id ?? null);
      recordRecentlyViewed(d.product.slug);
    }).catch(setError);
  }, [slug]);

  useEffect(() => {
    if (!data) return undefined;
    const s = getSocket();
    const onRating = (r) => setRating((cur) => ({ ...r, mine: cur?.mine ?? null }));
    s.on('rating:updated', onRating);
    return () => s.off('rating:updated', onRating);
  }, [data]);

  const p = data?.product;
  usePageMeta(p ? {
    title: p.name,
    description: `${p.shortDescription} ${p.brand}, from ${vnd(p.price)}. Genuine product with official warranty at TechHaven.`,
    image: p.images[0],
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      brand: { '@type': 'Brand', name: p.brand },
      category: p.category.name,
      description: p.shortDescription,
      image: p.images.map((u) => new URL(u, window.location.origin).href),
      sku: p.variants[0]?.sku,
      ...(p.rating.count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating.average, reviewCount: p.rating.count } } : {}),
      offers: p.variants.map((v) => ({ '@type': 'Offer', sku: v.sku, name: v.name, price: v.price, priceCurrency: 'VND', availability: `https://schema.org/${v.stock > 0 ? 'InStock' : 'OutOfStock'}` })),
    },
  } : {});

  if (error) return <div className="container py-5"><ErrorAlert error={error} /><Link to="/products">Back to products</Link></div>;
  if (!data) return <Spinner />;
  const variant = p.variants.find((v) => v.id === variantId);
  // The first lines of the description (at least five) are shown next to the price.
  const lines = p.description.split('\n').map((l) => l.trim()).filter(Boolean);
  const cut = lines.findIndex((l) => /^key specifications/i.test(l));
  const summaryLines = (cut > 0 ? lines.slice(0, cut) : lines).slice(0, 6);

  const addToCart = () => {
    if (variant) add(variant.id, qty);
  };
  const buyNow = () => {
    if (!variant) return;
    add(variant.id, qty, { openMiniCart: false });
    navigate('/checkout');
  };

  return (
    <div className="container py-4">
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb small">
          <li className="breadcrumb-item"><Link to="/">Home</Link></li>
          <li className="breadcrumb-item"><Link to={`/category/${p.category.slug}`}>{p.category.name}</Link></li>
          <li className="breadcrumb-item active text-truncate">{p.name}</li>
        </ol>
      </nav>
      <div className="row g-4">
        <div className="col-lg-6">
          <div className="gallery-main mb-2" tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') setImage((i) => (i - 1 + p.images.length) % p.images.length);
              if (e.key === 'ArrowRight') setImage((i) => (i + 1) % p.images.length);
            }}>
            {p.images.length > 0 && <img src={p.images[image]} alt={`${p.name} image ${image + 1}`} onClick={() => setZoom(true)} style={{ cursor: 'zoom-in' }} />}
            {p.images.length > 0 && <button type="button" className="gallery-zoom" onClick={() => setZoom(true)} aria-label="Enlarge image"><i className="bi bi-arrows-fullscreen" /></button>}
            {p.images.length > 1 && (
              <>
                <button type="button" className="gallery-nav prev" onClick={() => setImage((i) => (i - 1 + p.images.length) % p.images.length)} aria-label="Previous image"><i className="bi bi-chevron-left" /></button>
                <button type="button" className="gallery-nav next" onClick={() => setImage((i) => (i + 1) % p.images.length)} aria-label="Next image"><i className="bi bi-chevron-right" /></button>
                <span className="gallery-count">{image + 1} / {p.images.length}</span>
              </>
            )}
          </div>
          {p.images.length > 1 && (
            <div className="gallery-strip">
              {p.images.map((src, i) => (
                <button key={src} className={`gallery-thumb ${i === image ? 'active' : ''}`} onClick={() => setImage(i)} aria-label={`Show image ${i + 1}`}>
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-lg-6">
          <div className="text-uppercase small fw-semibold text-primary">{p.brand}</div>
          <h1 className="h3">{p.name}</h1>
          <div className="d-flex align-items-center gap-2 small mb-3 flex-wrap">
            <Stars value={rating.average} /> <span>{rating.average.toFixed(1)}</span>
            <span className="text-muted">({rating.count} ratings)</span>
            <span className="text-muted">· {p.soldCount} sold</span>
            <span className="text-muted">· SKU {variant?.sku}</span>
          </div>
          <div className="d-flex align-items-baseline flex-wrap gap-2 mb-3">
            <span className="display-6 fw-bold text-danger">{vnd(variant?.price ?? p.price)}</span>
            {variant?.compareAtPrice && (
              <>
                <del className="text-muted fs-5">{vnd(variant.compareAtPrice)}</del>
                <span className="badge text-bg-danger fs-6">-{variant.discountPercent}%</span>
                <span className="small text-success">You save {vnd(variant.compareAtPrice - variant.price)}</span>
              </>
            )}
          </div>
          <div className="product-overview mb-3">
            <div className="fw-semibold mb-1">Overview</div>
            <ul className="mb-0">{summaryLines.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>

          <div className="mb-3">
            <div className="fw-semibold mb-2">Choose a variant</div>
            <div className="d-flex flex-wrap gap-2">
              {p.variants.map((v) => (
                <button key={v.id} type="button" className={`variant-option ${v.id === variantId ? 'active' : ''}`} onClick={() => { setVariantId(v.id); setQty(1); }} disabled={v.stock === 0}>
                  <div className="fw-semibold">{v.name}</div>
                  <div className="small">{vnd(v.price)}{v.compareAtPrice && <del className="text-muted ms-1">{vnd(v.compareAtPrice)}</del>}</div>
                  <div className={`small ${v.stock === 0 ? 'text-danger' : v.stock <= 5 ? 'text-warning-emphasis' : 'text-success'}`}>
                    {v.stock === 0 ? 'Out of stock' : v.stock <= 5 ? `Only ${v.stock} left` : 'In stock'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="d-flex gap-2 align-items-center mb-3 flex-wrap">
            <div className="input-group" style={{ width: 140 }}>
              <button className="btn btn-outline-secondary" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"><i className="bi bi-dash" /></button>
              <input className="form-control text-center" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(variant?.stock || 1, Number(e.target.value) || 1)))} aria-label="Quantity" />
              <button className="btn btn-outline-secondary" onClick={() => setQty((q) => Math.min(variant?.stock || 1, q + 1))} aria-label="Increase quantity"><i className="bi bi-plus" /></button>
            </div>
            <button className="btn btn-outline-primary btn-lg flex-grow-1" disabled={!variant || variant.stock === 0} onClick={addToCart}>
              <i className="bi bi-cart-plus me-2" />Add to cart
            </button>
            <button className="btn btn-danger btn-lg flex-grow-1" disabled={!variant || variant.stock === 0} onClick={buyNow}>
              Buy now
            </button>
          </div>
          <div className="d-flex gap-3 mb-3 small">
            <button type="button" className={`btn btn-link p-0 text-decoration-none ${shop.inWishlist(p.id) ? 'text-danger' : 'text-muted'}`} onClick={() => shop.toggleWishlist(p)}>
              <i className={`bi ${shop.inWishlist(p.id) ? 'bi-heart-fill' : 'bi-heart'} me-1`} />{shop.inWishlist(p.id) ? 'In your wish list' : 'Add to wish list'}
            </button>
            <button type="button" className={`btn btn-link p-0 text-decoration-none ${shop.inCompare(p.slug) ? 'text-primary' : 'text-muted'}`} onClick={() => shop.toggleCompare(p)}>
              <i className="bi bi-arrow-left-right me-1" />{shop.inCompare(p.slug) ? 'Added to compare' : 'Compare'}
            </button>
          </div>
          <div className="row g-2 small text-muted">
            <div className="col-6"><i className="bi bi-shield-check me-1 text-success" />Official warranty</div>
            <div className="col-6"><i className="bi bi-truck me-1 text-success" />Free shipping from 5M₫</div>
            <div className="col-6"><i className="bi bi-arrow-repeat me-1 text-success" />7-day exchange</div>
            <div className="col-6"><i className="bi bi-gem me-1 text-success" />Earn {Math.floor(((variant?.price ?? 0) * 1.1 * 0.1) / 1000)} points</div>
          </div>
          {p.tags.length > 0 && (
            <div className="mt-3 d-flex flex-wrap gap-1">
              {p.tags.map((t) => <Link key={t} to={`/products?tag=${t}`} className="badge text-bg-light text-decoration-none">#{t}</Link>)}
            </div>
          )}
        </div>
      </div>

      <ul className="nav nav-tabs mt-5">
        {[['description', 'Description'], ['specs', 'Specifications']].map(([k, label]) => (
          <li className="nav-item" key={k}><button className={`nav-link ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button></li>
        ))}
      </ul>
      <div className="border border-top-0 rounded-bottom p-3 p-md-4 bg-white">
        {tab === 'description' && <div style={{ whiteSpace: 'pre-line' }}>{p.description}</div>}
        {tab === 'specs' && (
          <table className="table table-striped mb-0">
            <tbody>
              <tr><th style={{ width: '35%' }}>Brand</th><td>{p.brand}</td></tr>
              {Object.entries(p.specs).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
              <tr><th>Variants</th><td>{p.variants.map((v) => v.name).join(' · ')}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <section className="mt-5" id="reviews">
        <h2 className="section-title mb-3">Ratings & comments <span className="badge text-bg-success fs-6 align-middle"><i className="bi bi-broadcast me-1" />Live</span></h2>
        <div className="row g-4">
          <div className="col-lg-4"><RatingPanel product={p} rating={rating} setRating={setRating} /></div>
          <div className="col-lg-8"><Comments product={p} /></div>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="section-title mb-3">More in {p.category.name}</h2>
        <PagedProducts query={{ category: p.category.slug, sort: 'best_selling' }} perPage={4} />
      </section>

      <RecentlyViewed exclude={p.slug} />
      {zoom && <Lightbox images={p.images} index={image} onIndex={setImage} onClose={() => setZoom(false)} alt={p.name} />}
    </div>
  );
}

function RecentlyViewed({ exclude }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const slugs = recentlyViewed().filter((x) => x !== exclude);
    if (!slugs.length) {
      setItems([]);
      return;
    }
    api.get(`/products/by-slugs?slugs=${slugs.join(',')}`).then((r) => setItems(r.items)).catch(() => {});
  }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="mt-5">
      <h2 className="section-title mb-3">Recently viewed</h2>
      <PagedProducts items={items} perPage={4} />
    </section>
  );
}
