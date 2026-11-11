import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useShopping } from '../lib/shopping';
import { STATUS, vnd } from '../lib/format';

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="d-flex justify-content-center align-items-center py-5 text-muted gap-2">
      <div className="spinner-border spinner-border-sm" role="status" />
      <span>{label}</span>
    </div>
  );
}

export function Stars({ value = 0, size = '1rem', className = '' }) {
  return (
    <span className={`stars ${className}`} style={{ fontSize: size }} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`bi ${value >= i ? 'bi-star-fill' : value >= i - 0.5 ? 'bi-star-half' : 'bi-star'}`} />
      ))}
    </span>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, color: 'secondary', icon: 'circle' };
  return (
    <span className={`badge rounded-pill text-bg-${s.color}`}>
      <i className={`bi bi-${s.icon} me-1`} />
      {s.label}
    </span>
  );
}

// Page numbers are always shown, even when there is only one page.
export function Pagination({ page, totalPages, onChange, compact = false }) {
  const pages = [];
  const total = Math.max(1, totalPages || 1);
  const from = Math.max(1, Math.min(page - 2, total - 4));
  const to = Math.min(total, from + 4);
  for (let i = from; i <= to; i++) pages.push(i);
  const go = (p) => p >= 1 && p <= total && p !== page && onChange(p);
  return (
    <nav aria-label="Pagination" className={`d-flex justify-content-center ${compact ? 'mt-3' : 'my-4'}`}>
      <ul className={`pagination mb-0 ${compact ? 'pagination-sm' : ''}`}>
        <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
          <button className="page-link" onClick={() => go(page - 1)} aria-label="Previous page">
            <i className="bi bi-chevron-left" />
          </button>
        </li>
        {from > 1 && (
          <>
            <li className="page-item"><button className="page-link" onClick={() => go(1)}>1</button></li>
            {from > 2 && <li className="page-item disabled"><span className="page-link">…</span></li>}
          </>
        )}
        {pages.map((p) => (
          <li key={p} className={`page-item ${p === page ? 'active' : ''}`}>
            <button className="page-link" onClick={() => go(p)} aria-current={p === page ? 'page' : undefined}>{p}</button>
          </li>
        ))}
        {to < total && (
          <>
            {to < total - 1 && <li className="page-item disabled"><span className="page-link">…</span></li>}
            <li className="page-item"><button className="page-link" onClick={() => go(total)}>{total}</button></li>
          </>
        )}
        <li className={`page-item ${page >= total ? 'disabled' : ''}`}>
          <button className="page-link" onClick={() => go(page + 1)} aria-label="Next page">
            <i className="bi bi-chevron-right" />
          </button>
        </li>
      </ul>
    </nav>
  );
}

export function PriceTag({ price, compareAt, discount, from, size = '' }) {
  return (
    <div className={`price-tag ${size}`}>
      {from && <span className="small text-muted fw-normal me-1">From</span>}
      <span className="price">{vnd(price)}</span>
      {compareAt ? (
        <span className="ms-2 text-nowrap">
          <del className="text-muted small">{vnd(compareAt)}</del>
          <span className="badge text-bg-danger ms-1">-{discount}%</span>
        </span>
      ) : null}
    </div>
  );
}

export function ProductCard({ p }) {
  const shop = useShopping();
  const wished = shop?.inWishlist(p.id);
  const comparing = shop?.inCompare(p.slug);
  return (
    <div className="card product-card h-100">
      <Link to={`/products/${p.slug}`} className="product-thumb">
        <img src={p.image} alt={p.name} loading="lazy" />
        <div className="product-badges">
          {p.discountPercent > 0 && <span className="badge text-bg-danger">-{p.discountPercent}%</span>}
          {p.isNew && <span className="badge text-bg-info">New</span>}
          {!p.inStock && <span className="badge text-bg-secondary">Out of stock</span>}
        </div>
      </Link>
      {shop && (
        <div className="card-actions">
          <button type="button" className={`btn btn-light btn-sm ${wished ? 'text-danger' : ''}`} onClick={() => shop.toggleWishlist(p)}
            aria-label={wished ? 'Remove from wish list' : 'Add to wish list'} title={wished ? 'Remove from wish list' : 'Add to wish list'}>
            <i className={`bi ${wished ? 'bi-heart-fill' : 'bi-heart'}`} />
          </button>
          <button type="button" className={`btn btn-light btn-sm ${comparing ? 'text-primary' : ''}`} onClick={() => shop.toggleCompare(p)}
            aria-label={comparing ? 'Remove from comparison' : 'Compare'} title={comparing ? 'Remove from comparison' : 'Compare'}>
            <i className={`bi ${comparing ? 'bi-check2-square' : 'bi-arrow-left-right'}`} />
          </button>
        </div>
      )}
      <div className="card-body d-flex flex-column">
        <div className="small text-muted text-uppercase fw-semibold mb-1">{p.brand} · {p.category?.name}</div>
        <Link to={`/products/${p.slug}`} className="product-title">{p.name}</Link>
        {p.keySpecs?.length > 0 && (
          <div className="spec-chips mb-2">{p.keySpecs.map((s) => <span key={s} className="spec-chip">{s}</span>)}</div>
        )}
        <p className="small text-muted mb-2 line-clamp-2">{p.shortDescription}</p>
        <div className="d-flex align-items-center gap-2 small mb-2">
          <Stars value={p.avgRating} size=".8rem" />
          <span className="text-muted">({p.ratingCount})</span>
          {p.soldCount > 0 && <span className="text-muted ms-auto">{p.soldCount} sold</span>}
        </div>
        <div className="mt-auto d-flex align-items-end justify-content-between gap-2">
          <PriceTag price={p.price} compareAt={p.compareAtPrice} discount={p.discountPercent} from={p.variantCount > 1} />
          <Link to={`/products/${p.slug}`} className="btn btn-sm btn-outline-primary flex-shrink-0">View</Link>
        </div>
      </div>
    </div>
  );
}

// A product list with page numbers. Either server-side (query -> /api/products)
// or client-side (items). Used everywhere products are listed, as required.
export function PagedProducts({ query, items: localItems, perPage = 4, cols = 'col-6 col-md-4 col-lg-3', empty = null, onLoaded }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const key = JSON.stringify(query || null);
  useEffect(() => {
    setPage(1);
  }, [key]);
  useEffect(() => {
    if (!query) return;
    let live = true;
    api.get(`/products${qs({ ...query, page, limit: perPage })}`).then((r) => {
      if (!live) return;
      setData(r);
      onLoaded?.(r);
    }).catch(() => live && setData({ items: [], totalPages: 1, page: 1 }));
    return () => { live = false; };
  }, [key, page, perPage]); // eslint-disable-line react-hooks/exhaustive-deps

  let view = data;
  if (localItems) {
    const totalPages = Math.max(1, Math.ceil(localItems.length / perPage));
    view = { items: localItems.slice((page - 1) * perPage, page * perPage), totalPages, page: Math.min(page, totalPages) };
  }
  if (!view) return <Spinner />;
  if (!view.items.length) return empty;
  return (
    <>
      <div className="row g-3">
        {view.items.map((p) => <div key={p.id} className={cols}><ProductCard p={p} /></div>)}
      </div>
      <Pagination page={view.page} totalPages={view.totalPages} onChange={setPage} compact />
    </>
  );
}

export function EmptyState({ icon = 'inbox', title, children }) {
  return (
    <div className="text-center py-5 text-muted">
      <i className={`bi bi-${icon} display-5 d-block mb-3`} />
      <h5 className="text-body">{title}</h5>
      {children}
    </div>
  );
}

export function ErrorAlert({ error }) {
  if (!error) return null;
  return (
    <div className="alert alert-danger d-flex gap-2 align-items-start" role="alert">
      <i className="bi bi-exclamation-triangle-fill" />
      <div>{error.message || String(error)}</div>
    </div>
  );
}
