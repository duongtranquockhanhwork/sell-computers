import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../lib/api';
import { PAYMENT, STATUS, date, dateTime, plural, vnd } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorAlert, Pagination, Spinner, StatusBadge } from '../../components/common';
import { OrderInfo, OrderItems, OrderTimeline, OrderTotals } from '../../components/OrderView';

// ---------------- Orders ----------------
const RANGES = [['', 'All time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Date range']];

export function AdminOrders() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ range: '', status: params.get('status') || '', q: '', from: '', to: '', page: 1 });
  const [draft, setDraft] = useState({ q: '', from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { document.title = 'Orders - TechHaven Admin'; }, []);
  useEffect(() => {
    if (f.range === 'custom' && (!f.from || !f.to)) return;
    setData(null);
    setError(null);
    api.get(`/admin/orders${qs(f)}`).then(setData).catch(setError);
  }, [f]);

  return (
    <>
      <h1 className="h4 mb-3">Orders</h1>
      <div className="card mb-3"><div className="card-body vstack gap-2">
        <div className="d-flex flex-wrap gap-1">
          {RANGES.map(([k, label]) => (
            <button key={k} className={`btn btn-sm ${f.range === k ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setF({ ...f, range: k, page: 1 })}>{label}</button>
          ))}
        </div>
        <div className="d-flex flex-wrap gap-2 align-items-end">
          {f.range === 'custom' && (
            <form className="d-flex gap-2 align-items-end" onSubmit={(e) => { e.preventDefault(); setF({ ...f, from: draft.from, to: draft.to, page: 1 }); }}>
              <div><label className="form-label small mb-0" htmlFor="of">Start</label><input id="of" type="date" required className="form-control form-control-sm" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></div>
              <div><label className="form-label small mb-0" htmlFor="ot">End</label><input id="ot" type="date" required className="form-control form-control-sm" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></div>
              <button className="btn btn-sm btn-primary">Apply</button>
            </form>
          )}
          <select className="form-select form-select-sm" style={{ width: 160 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status filter">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <form className="input-group input-group-sm" style={{ maxWidth: 320 }} onSubmit={(e) => { e.preventDefault(); setF({ ...f, q: draft.q, page: 1 }); }}>
            <input className="form-control" placeholder="Order number, customer or email" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
            <button className="btn btn-outline-secondary" aria-label="Search"><i className="bi bi-search" /></button>
          </form>
          {data && <span className="ms-auto small text-muted">{plural(data.total, 'order')} · {vnd(data.sum)}</span>}
        </div>
      </div></div>
      <ErrorAlert error={error} />
      {f.range === 'custom' && (!f.from || !f.to) ? <div className="text-muted small">Pick a start and end date.</div> : !data ? <Spinner /> : (
        <div className="card"><div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="small"><tr><th>Order</th><th>Customer</th><th>Placed</th><th className="text-center">Items</th><th>Payment</th><th>Discount</th><th className="text-end">Total</th><th>Status</th></tr></thead>
            <tbody>
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/admin/orders/${o.order_number}`} className="fw-semibold">{o.order_number}</Link></td>
                  <td><div>{o.full_name}</div><div className="small text-muted">{o.email}</div></td>
                  <td className="small text-nowrap">{dateTime(o.created_at)}</td>
                  <td className="text-center">{o.item_count}</td>
                  <td className="small">{PAYMENT[o.payment_method]}<div><span className={`badge ${o.payment_status === 'paid' ? 'text-bg-success' : 'text-bg-warning'}`}>{o.payment_status}</span></div></td>
                  <td className="small">{o.discount_code ? <span className="badge text-bg-info">{o.discount_code}</span> : '-'}</td>
                  <td className="text-end fw-semibold">{vnd(o.total)}</td>
                  <td><StatusBadge status={o.status} /></td>
                </tr>
              ))}
              {data.items.length === 0 && <tr><td colSpan={8}><EmptyState icon="receipt" title="No orders in this range" /></td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={(page) => setF({ ...f, page })} />}
    </>
  );
}

export function AdminOrderDetail() {
  const { number } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get(`/admin/orders/${number}`).then(setData).catch(setError); }, [number]);

  const change = async (status) => {
    if (status === 'cancelled' && !window.confirm('Cancel this order? Stock and loyalty points will be restored.')) return;
    setBusy(true);
    try {
      const r = await api.patch(`/admin/orders/${number}/status`, { status, note: note || undefined });
      setData(r);
      setNote('');
      toast(`Order is now ${STATUS[status].label}`);
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Spinner />;
  const { order, nextStatuses } = data;
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <Link to="/admin/orders" className="btn btn-sm btn-link px-0"><i className="bi bi-arrow-left" /></Link>
        <h1 className="h4 mb-0">Order {order.orderNumber}</h1>
        <StatusBadge status={order.status} />
      </div>
      <div className="card mb-3"><div className="card-body"><OrderInfo order={order} /></div></div>
      <div className="row g-3">
        <div className="col-xl-8">
          <div className="card mb-3"><div className="card-body"><OrderItems order={order} /></div></div>
          <div className="card"><div className="card-header bg-white fw-semibold">Status history</div><div className="card-body"><OrderTimeline history={order.history} /></div></div>
        </div>
        <div className="col-xl-4">
          <div className="card mb-3"><div className="card-body"><OrderTotals order={order} /></div></div>
          <div className="card"><div className="card-body">
            <h6>Update status</h6>
            {nextStatuses.length === 0 ? <div className="small text-muted">This order is {STATUS[order.status].label.toLowerCase()} and can no longer change.</div> : (
              <>
                <input className="form-control form-control-sm mb-2" maxLength={300} placeholder="Note for the customer (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="d-flex flex-wrap gap-2">
                  {nextStatuses.map((s) => (
                    <button key={s} className={`btn btn-sm btn-${s === 'cancelled' ? 'outline-danger' : 'primary'}`} disabled={busy} onClick={() => change(s)}>
                      <i className={`bi bi-${STATUS[s].icon} me-1`} />Mark as {STATUS[s].label}
                    </button>
                  ))}
                </div>
                <div className="small text-muted mt-2">The customer is notified by email and in real time.</div>
              </>
            )}
          </div></div>
        </div>
      </div>
    </>
  );
}

// ---------------- Users ----------------
export function AdminUsers() {
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: '', page: 1 });
  const [draft, setDraft] = useState('');
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get(`/admin/users${qs(f)}`).then(setData).catch(setError);
  useEffect(() => { document.title = 'Users - TechHaven Admin'; }, []);
  useEffect(() => { setData(null); load(); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    const r = await api.get(`/admin/users/${id}`);
    setSelected(r);
    setEdit({ fullName: r.user.full_name, email: r.user.email, phone: r.user.phone || '' });
  };
  const saveUser = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/admin/users/${selected.user.id}`, edit);
      toast('User updated');
      load();
      open(selected.user.id);
    } catch (err) {
      toast(err.message, 'danger');
    }
  };
  const toggleBan = async (u) => {
    const banned = !u.is_banned;
    if (!window.confirm(`${banned ? 'Ban' : 'Unban'} ${u.email}?`)) return;
    try {
      await api.post(`/admin/users/${u.id}/ban`, { banned });
      toast(banned ? 'User banned' : 'User unbanned');
      load();
      if (selected?.user.id === u.id) open(u.id);
    } catch (err) {
      toast(err.message, 'danger');
    }
  };

  return (
    <>
      <h1 className="h4 mb-3">Users</h1>
      <div className="card mb-3"><div className="card-body d-flex flex-wrap gap-2">
        <form className="input-group" style={{ maxWidth: 360 }} onSubmit={(e) => { e.preventDefault(); setF({ ...f, q: draft, page: 1 }); }}>
          <input className="form-control" placeholder="Name, email or phone" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-outline-secondary" aria-label="Search"><i className="bi bi-search" /></button>
        </form>
        <select className="form-select" style={{ maxWidth: 180 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status filter">
          <option value="">All accounts</option><option value="active">Active</option><option value="banned">Banned</option>
        </select>
        {data && <span className="ms-auto align-self-center small text-muted">{data.total} accounts</span>}
      </div></div>
      <ErrorAlert error={error} />
      <div className="row g-3">
        <div className={selected ? 'col-xl-7' : 'col-12'}>
          {!data ? <Spinner /> : (
            <div className="card"><div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="small"><tr><th>User</th><th>Joined</th><th className="text-center">Orders</th><th className="text-end">Spent</th><th className="text-center">Points</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id} className={selected?.user.id === u.id ? 'table-active' : ''}>
                      <td role="button" onClick={() => open(u.id)}>
                        <div className="fw-semibold">{u.full_name} {u.role === 'admin' && <span className="badge text-bg-dark">Admin</span>} {u.has_google && <i className="bi bi-google text-muted" title="Google account" />}</div>
                        <div className="small text-muted">{u.email}</div>
                      </td>
                      <td className="small">{date(u.created_at)}</td>
                      <td className="text-center">{u.order_count}</td>
                      <td className="text-end small">{vnd(u.total_spent)}</td>
                      <td className="text-center">{u.loyalty_points}</td>
                      <td>{u.is_banned ? <span className="badge text-bg-danger">Banned</span> : <span className="badge text-bg-success">Active</span>}</td>
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-outline-primary me-1" onClick={() => open(u.id)} aria-label="View"><i className="bi bi-eye" /></button>
                        {u.role !== 'admin' && <button className={`btn btn-sm ${u.is_banned ? 'btn-outline-success' : 'btn-outline-danger'}`} onClick={() => toggleBan(u)}>{u.is_banned ? 'Unban' : 'Ban'}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          )}
          {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={(page) => setF({ ...f, page })} />}
        </div>
        {selected && (
          <div className="col-xl-5">
            <div className="card"><div className="card-body">
              <div className="d-flex justify-content-between mb-2"><h6 className="mb-0">Account details</h6><button className="btn-close" onClick={() => setSelected(null)} aria-label="Close" /></div>
              <form onSubmit={saveUser} className="vstack gap-2 mb-3">
                <div><label className="form-label small mb-0" htmlFor="uf">Full name</label><input id="uf" className="form-control form-control-sm" required value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></div>
                <div><label className="form-label small mb-0" htmlFor="ue">Email</label><input id="ue" type="email" className="form-control form-control-sm" required value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
                <div><label className="form-label small mb-0" htmlFor="up">Phone</label><input id="up" className="form-control form-control-sm" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
                <button className="btn btn-sm btn-primary align-self-start">Save changes</button>
              </form>
              <div className="small mb-2"><b>{selected.user.loyalty_points}</b> loyalty points · joined {date(selected.user.created_at)}</div>
              <h6 className="small fw-semibold">Addresses</h6>
              <ul className="small ps-3">{selected.addresses.map((a) => <li key={a.id}>{a.recipient} · {a.formatted} {a.isDefault && <span className="badge text-bg-primary">Default</span>}</li>)}</ul>
              <h6 className="small fw-semibold">Recent orders</h6>
              <table className="table table-sm small mb-0"><tbody>
                {selected.orders.map((o) => <tr key={o.order_number}><td><Link to={`/admin/orders/${o.order_number}`}>{o.order_number}</Link></td><td>{date(o.created_at)}</td><td><StatusBadge status={o.status} /></td><td className="text-end">{vnd(o.total)}</td></tr>)}
                {selected.orders.length === 0 && <tr><td className="text-muted">No orders</td></tr>}
              </tbody></table>
            </div></div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- Discount codes ----------------
export function AdminDiscounts() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ code: '', type: 'percent', value: 10, usageLimit: 10 });
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get('/admin/discounts').then((r) => setList(r.items)).catch(setError);
  useEffect(() => { document.title = 'Discount codes - TechHaven Admin'; load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { discount } = await api.post('/admin/discounts', { ...form, value: Number(form.value), usageLimit: Number(form.usageLimit) });
      toast(`Code ${discount.code} created`);
      setForm({ ...form, code: '' });
      load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <h1 className="h4 mb-3">Discount codes</h1>
      <div className="row g-3">
        <div className="col-xl-8">
          <div className="card"><div className="table-responsive">
            {!list ? <Spinner /> : (
              <table className="table align-middle mb-0">
                <thead className="small"><tr><th>Code</th><th>Created</th><th>Value</th><th>Usage</th><th className="text-end">Total discounted</th><th /></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.id}>
                      <td><span className="badge text-bg-dark fs-6 font-monospace">{d.code}</span></td>
                      <td className="small">{dateTime(d.created_at)}</td>
                      <td>{d.type === 'percent' ? `${d.value}%` : vnd(d.value)}</td>
                      <td style={{ minWidth: 140 }}>
                        <div className="small">{d.used_count} / {d.usage_limit} used</div>
                        <div className="progress" style={{ height: 6 }}><div className={`progress-bar ${d.used_count >= d.usage_limit ? 'bg-danger' : 'bg-success'}`} style={{ width: `${(d.used_count / d.usage_limit) * 100}%` }} /></div>
                      </td>
                      <td className="text-end small">{vnd(d.total_discounted)}</td>
                      <td className="text-end"><button className="btn btn-sm btn-outline-primary" onClick={() => api.get(`/admin/discounts/${d.id}/orders`).then(setOrders)}>Orders ({d.order_count})</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>
          {orders && (
            <div className="card mt-3"><div className="card-body">
              <div className="d-flex justify-content-between"><h6>Orders using {orders.discount.code}</h6><button className="btn-close" onClick={() => setOrders(null)} aria-label="Close" /></div>
              {orders.orders.length === 0 ? <div className="small text-muted">This code has not been used yet.</div> : (
                <table className="table table-sm small mb-0">
                  <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th className="text-end">Subtotal</th><th className="text-end">Discount</th><th className="text-end">Total</th><th>Status</th></tr></thead>
                  <tbody>{orders.orders.map((o) => (
                    <tr key={o.order_number}><td><Link to={`/admin/orders/${o.order_number}`}>{o.order_number}</Link></td><td>{o.full_name}</td><td>{date(o.created_at)}</td><td className="text-end">{vnd(o.subtotal)}</td><td className="text-end text-success">-{vnd(o.discount_amount)}</td><td className="text-end">{vnd(o.total)}</td><td><StatusBadge status={o.status} /></td></tr>
                  ))}</tbody>
                </table>
              )}
            </div></div>
          )}
        </div>
        <div className="col-xl-4">
          <form className="card card-body" onSubmit={create}>
            <h6>Create a discount code</h6>
            <ErrorAlert error={error} />
            <div className="mb-2">
              <label className="form-label small" htmlFor="dc">Code (5 letters/digits)</label>
              <input id="dc" className="form-control font-monospace text-uppercase" maxLength={5} pattern="[A-Za-z0-9]{5}" placeholder="Leave empty to generate" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase() })} />
            </div>
            <div className="row g-2 mb-2">
              <div className="col-6"><label className="form-label small" htmlFor="dt">Type</label>
                <select id="dt" className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, value: e.target.value === 'percent' ? 10 : 100000 })}>
                  <option value="percent">Percentage</option><option value="fixed">Fixed amount</option>
                </select>
              </div>
              <div className="col-6"><label className="form-label small" htmlFor="dv">{form.type === 'percent' ? 'Percent (%)' : 'Amount (₫)'}</label>
                <input id="dv" type="number" className="form-control" required min={form.type === 'percent' ? 1 : 1000} max={form.type === 'percent' ? 100 : undefined} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              </div>
            </div>
            <div className="mb-3"><label className="form-label small" htmlFor="du">Usage limit (max 10)</label><input id="du" type="number" min={1} max={10} required className="form-control" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} /></div>
            <div className="small text-muted mb-3">Codes never expire; they stop working once the usage limit is reached.</div>
            <button className="btn btn-primary">Create code</button>
          </form>
        </div>
      </div>
    </>
  );
}
