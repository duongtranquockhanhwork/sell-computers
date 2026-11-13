import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { plural, vnd } from '../lib/format';
import { EmptyState, ErrorAlert, Pagination, PriceTag, ProductCard, Spinner } from '../components/common';
import { usePageMeta } from '../lib/seo';

const SORTS = [
  ['relevance', 'Relevance'],
  ['newest', 'Newest'],
  ['best_selling', 'Best selling'],
  ['name_asc', 'Name: A to Z'],
  ['name_desc', 'Name: Z to A'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['rating', 'Top rated'],
  ['discount', 'Biggest discount'],
];

const PRICE_PRESETS = [
  ['', 2000000, 'Under 2M'],
  [2000000, 5000000, '2M - 5M'],
  [5000000, 15000000, '5M - 15M'],
  [15000000, 30000000, '15M - 30M'],
  [30000000, '', 'Over 30M'],
];

const BRAND_PILLS = 10;

export default function Catalog() {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [brands, setBrands] = useState([]);
  const [allBrands, setAllBrands] = useState(false);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('techhaven.view') || 'grid'; } catch { return 'grid'; }
  });
  const [showFilters, setShowFilters] = useState(false);

  const q = params.get('q') || '';
  const category = slug || params.get('category') || '';
  const filters = useMemo(() => ({
    q,
    category,
    brand: params.get('brand') || '',
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    minRating: params.get('minRating') || '',
    tag: params.get('tag') || '',
    inStock: params.get('inStock') || '',
    onSale: params.get('onSale') || '',
    sort: params.get('sort') || (q ? 'relevance' : 'newest'),
    page: Number(params.get('page') || 1),
  }), [params, q, category]);

  const [priceDraft, setPriceDraft] = useState({ min: filters.minPrice, max: filters.maxPrice });
  useEffect(() => {
    setPriceDraft({ min: filters.minPrice, max: filters.maxPrice });
  }, [filters.minPrice, filters.maxPrice]);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.categories)).catch(() => {});
    api.get('/tags').then((r) => setTags(r.tags)).catch(() => {});
  }, []);
  useEffect(() => {
    api.get(`/brands${qs({ category })}`).then((r) => setBrands(r.brands)).catch(() => {});
  }, [category]);

  useEffect(() => {
    setData(null);
    setError(null);
    api.get(`/products${qs({ ...filters, limit: 12 })}`).then(setData).catch(setError);
  }, [filters]);

  const current = categories.find((c) => c.slug === category);
  usePageMeta({
    title: q ? `Search "${q}"` : filters.tag ? `#${filters.tag} products` : current?.name || 'All products',
    description: current?.description ? `${current.name}: ${current.description} Genuine products, official warranty and fast delivery at TechHaven.` : undefined,
  });

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === '' || v === null || v === undefined) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };

  const selectedBrands = filters.brand ? filters.brand.split(',') : [];
  const toggleBrand = (b) => {
    const set = new Set(selectedBrands);
    set.has(b) ? set.delete(b) : set.add(b);
    update({ brand: [...set].join(',') });
  };
  const setViewMode = (m) => {
    setView(m);
    try { localStorage.setItem('techhaven.view', m); } catch { /* ignore */ }
  };
  const activeFilters = [filters.brand, filters.minPrice, filters.maxPrice, filters.minRating, filters.inStock, filters.tag, filters.onSale].filter(Boolean).length;

  const sidebar = (
    <div className="filter-panel">
      {!slug && (
        <div className="mb-4">
          <h6 className="filter-title">Category</h6>
          <select className="form-select form-select-sm" value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
      )}
      <div className="mb-4">
        <h6 className="filter-title">Brand</h6>
        <div className="brand-list">
          {brands.map((b) => (
            <div className="form-check" key={b.name}>
              <input className="form-check-input" type="checkbox" id={`b-${b.name}`} checked={selectedBrands.includes(b.name)} onChange={() => toggleBrand(b.name)} />
              <label className="form-check-label small d-flex justify-content-between w-100" htmlFor={`b-${b.name}`}>
                <span>{b.name}</span><span className="text-muted">{b.count}</span>
              </label>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <h6 className="filter-title">Price (₫)</h6>
        <form className="d-flex gap-1 mb-2" onSubmit={(e) => { e.preventDefault(); update({ minPrice: priceDraft.min, maxPrice: priceDraft.max }); }}>
          <input className="form-control form-control-sm" type="number" min="0" step="100000" placeholder="Min" value={priceDraft.min} onChange={(e) => setPriceDraft({ ...priceDraft, min: e.target.value })} aria-label="Minimum price" />
          <input className="form-control form-control-sm" type="number" min="0" step="100000" placeholder="Max" value={priceDraft.max} onChange={(e) => setPriceDraft({ ...priceDraft, max: e.target.value })} aria-label="Maximum price" />
          <button className="btn btn-sm btn-primary" type="submit">Go</button>
        </form>
        <div className="d-flex flex-wrap gap-1">
          {PRICE_PRESETS.map(([min, max, label]) => (
            <button key={label} className={`btn btn-sm ${String(filters.minPrice) === String(min) && String(filters.maxPrice) === String(max) ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => update({ minPrice: min, maxPrice: max })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <h6 className="filter-title">Customer rating</h6>
        {[4, 3, 2].map((r) => (
          <div className="form-check" key={r}>
            <input className="form-check-input" type="radio" name="rating" id={`r-${r}`} checked={filters.minRating === String(r)} onChange={() => update({ minRating: String(r) })} />
            <label className="form-check-label small" htmlFor={`r-${r}`}>{r}<i className="bi bi-star-fill text-warning mx-1" />& up</label>
          </div>
        ))}
      </div>
      <div className="form-check form-switch mb-2">
        <input className="form-check-input" type="checkbox" id="instock" checked={filters.inStock === 'true'} onChange={(e) => update({ inStock: e.target.checked ? 'true' : '' })} />
        <label className="form-check-label small" htmlFor="instock">In stock only</label>
      </div>
      <div className="form-check form-switch mb-4">
        <input className="form-check-input" type="checkbox" id="onsale" checked={filters.onSale === 'true'} onChange={(e) => update({ onSale: e.target.checked ? 'true' : '' })} />
        <label className="form-check-label small" htmlFor="onsale">On sale</label>
      </div>
      {tags.length > 0 && (
        <div className="mb-4">
          <h6 className="filter-title">Popular tags</h6>
          <div className="d-flex flex-wrap gap-1">
            {tags.slice(0, 18).map((t) => (
              <button key={t.name} className={`btn btn-sm ${filters.tag === t.name ? 'btn-primary' : 'btn-outline-secondary'} tag-btn`} onClick={() => update({ tag: filters.tag === t.name ? '' : t.name })}>#{t.name}</button>
            ))}
          </div>
        </div>
      )}
      {activeFilters > 0 && (
        <button className="btn btn-sm btn-outline-danger w-100" onClick={() => update({ brand: '', minPrice: '', maxPrice: '', minRating: '', inStock: '', tag: '', onSale: '' })}>
          <i className="bi bi-x-circle me-1" />Clear filters
        </button>
      )}
    </div>
  );

  return (
    <div className="container py-4">
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb small">
          <li className="breadcrumb-item"><Link to="/">Home</Link></li>
          <li className="breadcrumb-item"><Link to="/products">Products</Link></li>
          {current && <li className="breadcrumb-item active">{current.name}</li>}
        </ol>
      </nav>
      <div className="d-flex flex-wrap align-items-end justify-content-between gap-2 mb-3">
        <div>
          <h1 className="h3 mb-1">{q ? <>Results for “{q}”</> : current?.name || 'All products'}</h1>
          <div className="text-muted small">
            {data ? plural(data.total, 'product') : '...'}
            {current?.description && ` · ${current.description}`}
            {filters.tag && <span className="badge text-bg-light ms-2">#{filters.tag} <button className="btn-close btn-close-sm ms-1" style={{ fontSize: '.5rem' }} onClick={() => update({ tag: '' })} aria-label="Remove tag" /></span>}
          </div>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <button className="btn btn-outline-secondary btn-sm d-lg-none" onClick={() => setShowFilters((s) => !s)}>
            <i className="bi bi-funnel me-1" />Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          <select className="form-select form-select-sm" style={{ width: 190 }} value={filters.sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort products">
            {SORTS.filter(([k]) => k !== 'relevance' || q).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <div className="btn-group btn-group-sm" role="group" aria-label="View mode">
            <button className={`btn btn-outline-secondary ${view === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} aria-label="Grid view"><i className="bi bi-grid-3x3-gap" /></button>
            <button className={`btn btn-outline-secondary ${view === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')} aria-label="List view"><i className="bi bi-list-ul" /></button>
          </div>
        </div>
      </div>

      <div className="row g-4">
        <aside className={`col-lg-3 ${showFilters ? '' : 'd-none d-lg-block'}`}>{sidebar}</aside>
        <div className="col-lg-9">
          {brands.length > 1 && (
            <div className="brand-strip mb-3">
              {/* The 10 brands with most products (and any selected one); the rest behind "+N more". */}
              {(allBrands ? brands : [...brands].sort((a, b) => b.count - a.count).filter((b, i) => i < BRAND_PILLS || selectedBrands.includes(b.name))).map((b) => (
                <button key={b.name} className={`brand-pill ${selectedBrands.includes(b.name) ? 'active' : ''}`} onClick={() => toggleBrand(b.name)}>{b.name}<span>{b.count}</span></button>
              ))}
              {brands.length > BRAND_PILLS && (
                <button className="brand-pill brand-more" onClick={() => setAllBrands(!allBrands)}>
                  {allBrands ? 'Show less' : `+${brands.length - BRAND_PILLS} more`}
                </button>
              )}
            </div>
          )}
          <ErrorAlert error={error} />
          {!data && !error && <Spinner />}
          {data && data.items.length === 0 && (
            <EmptyState icon="search" title="No products match your filters">Try removing a filter or searching for something else.</EmptyState>
          )}
          {data && data.items.length > 0 && view === 'grid' && (
            <div className="row g-3">
              {data.items.map((p) => <div key={p.id} className="col-6 col-md-4"><ProductCard p={p} /></div>)}
            </div>
          )}
          {data && data.items.length > 0 && view === 'list' && (
            <div className="vstack gap-3">
              {data.items.map((p) => (
                <div key={p.id} className="card product-row">
                  <div className="row g-0 align-items-center">
                    <div className="col-4 col-md-3"><Link to={`/products/${p.slug}`}><img src={p.image} alt={p.name} className="img-fluid rounded-start" loading="lazy" /></Link></div>
                    <div className="col-8 col-md-9">
                      <div className="card-body">
                        <div className="small text-muted text-uppercase fw-semibold">{p.brand} · {p.category.name}</div>
                        <Link to={`/products/${p.slug}`} className="product-title h6 d-block">{p.name}</Link>
                        <p className="small text-muted mb-2 d-none d-md-block">{p.shortDescription}</p>
                        <div className="d-flex align-items-center gap-3 flex-wrap">
                          <PriceTag price={p.price} compareAt={p.compareAtPrice} discount={p.discountPercent} from={p.variantCount > 1} />
                          <span className="small text-muted"><i className="bi bi-star-fill text-warning" /> {p.avgRating.toFixed(1)} ({p.ratingCount})</span>
                          {!p.inStock && <span className="badge text-bg-secondary">Out of stock</span>}
                          <Link to={`/products/${p.slug}`} className="btn btn-sm btn-outline-primary ms-auto">View details</Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={(p) => { update({ page: p }); window.scrollTo(0, 0); }} />}
          {data?.engine === 'elasticsearch' && <div className="text-center small text-muted">Search powered by ElasticSearch</div>}
        </div>
      </div>
    </div>
  );
}
