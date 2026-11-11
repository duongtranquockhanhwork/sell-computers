import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { date, vnd } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { ErrorAlert, Pagination, Spinner } from '../../components/common';
import ImageManager from '../../components/ImageManager';

export function ProductList() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', category: '', lowStock: params.get('lowStock') || '', page: 1 });
  const [draft, setDraft] = useState('');
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState(null);

  const load = () => api.get(`/admin/products${qs(filters)}`).then(setData).catch(setError);
  useEffect(() => { document.title = 'Products - TechHaven Admin'; api.get('/admin/categories').then((r) => setCats(r.categories)); }, []);
  useEffect(() => { setData(null); load(); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (p) => {
    if (!window.confirm(`Delete "${p.name}"? Order history keeps a copy of its name and price.`)) return;
    try {
      await api.del(`/admin/products/${p.id}`);
      toast('Product deleted');
      load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  };

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">Products</h1>
        <Link to="/admin/products/new" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />New product</Link>
      </div>
      <div className="card mb-3"><div className="card-body d-flex flex-wrap gap-2">
        <form className="input-group" style={{ maxWidth: 360 }} onSubmit={(e) => { e.preventDefault(); setFilters({ ...filters, q: draft, page: 1 }); }}>
          <input className="form-control" placeholder="Search name, brand or SKU" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-outline-secondary"><i className="bi bi-search" /></button>
        </form>
        <select className="form-select" style={{ maxWidth: 220 }} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value, page: 1 })}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="form-check form-switch align-self-center">
          <input className="form-check-input" type="checkbox" id="low" checked={filters.lowStock === 'true'} onChange={(e) => setFilters({ ...filters, lowStock: e.target.checked ? 'true' : '', page: 1 })} />
          <label className="form-check-label small" htmlFor="low">Low stock (≤ 5)</label>
        </div>
        {data && <span className="ms-auto align-self-center small text-muted">{data.total} products</span>}
      </div></div>
      <ErrorAlert error={error} />
      {!data ? <Spinner /> : (
        <div className="card"><div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead className="small"><tr><th colSpan={2}>Product</th><th>Category</th><th className="text-end">From</th><th className="text-center">Variants</th><th className="text-center">Stock</th><th className="text-center">Sold</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 56 }}>{p.image && <img src={p.image} alt="" width={48} className="rounded" />}</td>
                  <td><Link to={`/admin/products/${p.id}`} className="fw-semibold">{p.name}</Link><div className="small text-muted">{p.brand} · added {date(p.created_at)}</div></td>
                  <td className="small">{p.category}</td>
                  <td className="text-end small">{vnd(p.min_price)}</td>
                  <td className="text-center">{p.variant_count}</td>
                  <td className="text-center"><span className={`badge ${p.stock === 0 ? 'text-bg-danger' : p.stock <= 10 ? 'text-bg-warning' : 'text-bg-light'}`}>{p.stock}</span></td>
                  <td className="text-center">{p.sold_count}</td>
                  <td>{p.is_active ? <span className="badge text-bg-success">Active</span> : <span className="badge text-bg-secondary">Hidden</span>}</td>
                  <td className="text-end text-nowrap">
                    <Link to={`/admin/products/${p.id}`} className="btn btn-sm btn-outline-primary me-1" aria-label="Edit"><i className="bi bi-pencil" /></Link>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => remove(p)} aria-label="Delete"><i className="bi bi-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={(page) => setFilters({ ...filters, page })} />}
    </>
  );
}

const EMPTY_VARIANT = { sku: '', name: '', price: '', compareAtPrice: '', costPrice: '', stock: 0, isActive: true };

export function ProductForm() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const [cats, setCats] = useState([]);
  const [p, setP] = useState(null);
  const [specText, setSpecText] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/admin/categories').then((r) => setCats(r.categories));
    if (isNew) {
      setP({ name: '', brand: '', categoryId: '', shortDescription: '', description: '', tags: '', isActive: true, images: [], variants: [{ ...EMPTY_VARIANT }, { ...EMPTY_VARIANT }] });
      return;
    }
    api.get(`/admin/products/${id}`).then(({ product: x }) => {
      setP({
        name: x.name, brand: x.brand, categoryId: x.category_id, shortDescription: x.short_description, description: x.description,
        tags: x.tags.join(', '), isActive: x.is_active, images: x.images,
        variants: x.variants.map((v) => ({ id: v.id, sku: v.sku, name: v.name, price: v.price, compareAtPrice: v.compare_at_price ?? '', costPrice: v.cost_price, stock: v.stock, isActive: v.is_active })),
      });
      setSpecText(Object.entries(x.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
    }).catch(setError);
  }, [id, isNew]);

  if (!p) return error ? <ErrorAlert error={error} /> : <Spinner />;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setVariant = (i, k, v) => setP({ ...p, variants: p.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    if (p.images.length < 1) return setError(new Error('Add at least one product image'));
    if (p.images.length > 10) return setError(new Error('A product can have at most 10 images'));
    if (p.description.split('\n').filter((l) => l.trim()).length < 5) return setError(new Error('The description should have at least five lines'));
    const specs = Object.fromEntries(specText.split('\n').map((l) => l.split(':')).filter((a) => a.length >= 2 && a[0].trim()).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
    const body = {
      ...p,
      categoryId: Number(p.categoryId),
      tags: p.tags.split(',').map((t) => t.trim()).filter(Boolean),
      specs,
      variants: p.variants.map((v) => ({ ...v, price: Number(v.price), compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : null, costPrice: Number(v.costPrice), stock: Number(v.stock) })),
    };
    setSaving(true);
    try {
      if (isNew) {
        const r = await api.post('/admin/products', body);
        toast('Product created');
        navigate(`/admin/products/${r.id}`, { replace: true });
      } else {
        await api.put(`/admin/products/${id}`, body);
        toast('Product saved');
      }
    } catch (err) {
      setError(err);
      window.scrollTo(0, 0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save}>
      <div className="d-flex align-items-center gap-2 mb-3">
        <Link to="/admin/products" className="btn btn-sm btn-link px-0"><i className="bi bi-arrow-left" /></Link>
        <h1 className="h4 mb-0">{isNew ? 'New product' : 'Edit product'}</h1>
        <button className="btn btn-primary ms-auto" disabled={saving}>{saving ? 'Saving...' : 'Save product'}</button>
      </div>
      <ErrorAlert error={error} />
      <div className="row g-3">
        <div className="col-xl-8">
          <div className="card card-body mb-3">
            <div className="row g-3">
              <div className="col-12"><label className="form-label small" htmlFor="pn">Name *</label><input id="pn" className="form-control" required minLength={3} value={p.name} onChange={set('name')} /></div>
              <div className="col-md-6"><label className="form-label small" htmlFor="pb">Brand *</label><input id="pb" className="form-control" required value={p.brand} onChange={set('brand')} /></div>
              <div className="col-md-6"><label className="form-label small" htmlFor="pc">Category *</label>
                <select id="pc" className="form-select" required value={p.categoryId} onChange={set('categoryId')}>
                  <option value="">Choose...</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-12"><label className="form-label small" htmlFor="ps">Short description *</label><input id="ps" className="form-control" required minLength={10} maxLength={300} value={p.shortDescription} onChange={set('shortDescription')} /></div>
              <div className="col-12"><label className="form-label small" htmlFor="pd">Description * (at least 5 lines)</label><textarea id="pd" className="form-control" rows={8} required value={p.description} onChange={set('description')} /></div>
              <div className="col-md-6"><label className="form-label small" htmlFor="sp">Specifications (one "Name: value" per line)</label><textarea id="sp" className="form-control font-monospace small" rows={6} value={specText} onChange={(e) => setSpecText(e.target.value)} /></div>
              <div className="col-md-6">
                <label className="form-label small" htmlFor="pt">Tags (comma separated)</label><input id="pt" className="form-control" value={p.tags} onChange={set('tags')} placeholder="gaming, rgb" />
                <div className="form-check form-switch mt-3"><input className="form-check-input" type="checkbox" id="pa" checked={p.isActive} onChange={set('isActive')} /><label className="form-check-label" htmlFor="pa">Visible in the store</label></div>
              </div>
            </div>
          </div>
          <div className="card card-body">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="mb-0">Variants & inventory</h6>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setP({ ...p, variants: [...p.variants, { ...EMPTY_VARIANT }] })}><i className="bi bi-plus" /> Add variant</button>
            </div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="small"><tr><th>SKU</th><th>Variant name</th><th>Price (₫)</th><th title="Optional original price, shown struck through">Original (₫)</th><th>Cost (₫)</th><th>Stock</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {p.variants.map((v, i) => (
                    <tr key={v.id || `n${i}`}>
                      <td><input className="form-control form-control-sm" required value={v.sku} onChange={(e) => setVariant(i, 'sku', e.target.value)} style={{ minWidth: 110 }} /></td>
                      <td><input className="form-control form-control-sm" required value={v.name} onChange={(e) => setVariant(i, 'name', e.target.value)} style={{ minWidth: 140 }} /></td>
                      <td><input type="number" min={1000} className="form-control form-control-sm" required value={v.price} onChange={(e) => setVariant(i, 'price', e.target.value)} style={{ minWidth: 110 }} /></td>
                      <td><input type="number" min={0} className="form-control form-control-sm" placeholder="optional" value={v.compareAtPrice ?? ''} onChange={(e) => setVariant(i, 'compareAtPrice', e.target.value)} style={{ minWidth: 110 }} aria-label="Original price" /></td>
                      <td><input type="number" min={0} className="form-control form-control-sm" required value={v.costPrice} onChange={(e) => setVariant(i, 'costPrice', e.target.value)} style={{ minWidth: 110 }} /></td>
                      <td><input type="number" min={0} className="form-control form-control-sm" required value={v.stock} onChange={(e) => setVariant(i, 'stock', e.target.value)} style={{ width: 80 }} /></td>
                      <td><input type="checkbox" className="form-check-input" checked={v.isActive} onChange={(e) => setVariant(i, 'isActive', e.target.checked)} aria-label="Active" /></td>
                      <td><button type="button" className="btn btn-sm btn-outline-danger" disabled={p.variants.length <= 1} onClick={() => setP({ ...p, variants: p.variants.filter((_, j) => j !== i) })} aria-label="Remove variant"><i className="bi bi-x" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <ImageManager images={p.images} onChange={(fn) => setP((cur) => ({ ...cur, images: typeof fn === 'function' ? fn(cur.images) : fn }))} />
        </div>
      </div>
    </form>
  );
}

export function Categories() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ id: null, name: '', description: '', icon: 'box', position: 0 });
  const [error, setError] = useState(null);
  const load = () => api.get('/admin/categories').then((r) => setList(r.categories)).catch(setError);
  useEffect(() => { document.title = 'Categories - TechHaven Admin'; load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (form.id) await api.put(`/admin/categories/${form.id}`, form);
      else await api.post('/admin/categories', form);
      toast('Category saved');
      setForm({ id: null, name: '', description: '', icon: 'box', position: 0 });
      load();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    try {
      await api.del(`/admin/categories/${c.id}`);
      toast('Category deleted');
      load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  };

  return (
    <>
      <h1 className="h4 mb-3">Categories</h1>
      <div className="row g-3">
        <div className="col-lg-8">
          <div className="card"><div className="table-responsive">
            {!list ? <Spinner /> : (
              <table className="table align-middle mb-0">
                <thead className="small"><tr><th>#</th><th>Name</th><th>Slug</th><th className="text-center">Products</th><th /></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td>{c.position}</td>
                      <td><div className="fw-semibold">{c.name}</div><div className="small text-muted">{c.description}</div></td>
                      <td className="small text-muted">{c.slug}</td>
                      <td className="text-center">{c.product_count}</td>
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => setForm({ id: c.id, name: c.name, description: c.description || '', icon: c.icon, position: c.position })} aria-label="Edit"><i className="bi bi-pencil" /></button>
                        <button className="btn btn-sm btn-outline-danger" disabled={c.product_count > 0} onClick={() => remove(c)} aria-label="Delete"><i className="bi bi-trash" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>
        </div>
        <div className="col-lg-4">
          <form className="card card-body" onSubmit={save}>
            <h6>{form.id ? 'Edit category' : 'New category'}</h6>
            <ErrorAlert error={error} />
            <div className="mb-2"><label className="form-label small" htmlFor="cn">Name *</label><input id="cn" className="form-control" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="mb-2"><label className="form-label small" htmlFor="cd">Description</label><textarea id="cd" className="form-control" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="row g-2 mb-3">
              <div className="col-7"><label className="form-label small" htmlFor="ci">Icon</label>
                <select id="ci" className="form-select" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                  {['laptop', 'desktop', 'monitor', 'cpu', 'gpu', 'ram', 'storage', 'motherboard', 'psu', 'box'].map((i) => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div className="col-5"><label className="form-label small" htmlFor="cp">Position</label><input id="cp" type="number" min={0} className="form-control" value={form.position} onChange={(e) => setForm({ ...form, position: Number(e.target.value) })} /></div>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-primary">{form.id ? 'Save' : 'Create'}</button>
              {form.id && <button type="button" className="btn btn-outline-secondary" onClick={() => setForm({ id: null, name: '', description: '', icon: 'box', position: 0 })}>Cancel</button>}
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
