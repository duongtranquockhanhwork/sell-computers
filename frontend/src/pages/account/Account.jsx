import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { date, vnd } from '../../lib/format';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { EmptyState, ErrorAlert, Pagination, Spinner, StatusBadge } from '../../components/common';
import { OrderInfo, OrderItems, OrderTimeline, OrderTotals, StatusProgress } from '../../components/OrderView';
import { AddressFields } from '../Checkout';

export function AccountLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <div className="container py-4">
      <div className="row g-4">
        <aside className="col-lg-3">
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-center gap-2 mb-3">
                <div className="avatar avatar-lg">{user.fullName.slice(0, 1)}</div>
                <div className="min-w-0"><div className="fw-semibold text-truncate">{user.fullName}</div><div className="small text-muted text-truncate">{user.email}</div></div>
              </div>
              <div className="loyalty-box mb-3"><i className="bi bi-gem me-2" /><b>{user.loyaltyPoints}</b> points · {vnd(user.loyaltyPoints * 1000)}</div>
              <nav className="nav nav-pills flex-column gap-1">
                <NavLink end to="/account" className="nav-link"><i className="bi bi-person me-2" />Profile & addresses</NavLink>
                <NavLink to="/account/orders" className="nav-link"><i className="bi bi-receipt me-2" />My orders</NavLink>
              </nav>
            </div>
          </div>
        </aside>
        <div className="col-lg-9"><Outlet /></div>
      </div>
    </div>
  );
}

function ProfileForm({ user, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone || '' });
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.put('/profile', form);
      onSaved(r.user);
      toast('Profile updated');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="card card-body mb-4" onSubmit={submit}>
      <h5 className="mb-3">Personal information</h5>
      <ErrorAlert error={error} />
      <div className="row g-3">
        <div className="col-md-6"><label className="form-label small" htmlFor="p-email">Email</label><input id="p-email" className="form-control" value={user.email} disabled /></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="p-since">Member since</label><input id="p-since" className="form-control" value={date(user.createdAt)} disabled /></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="p-name">Full name</label><input id="p-name" className="form-control" required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
        <div className="col-md-6"><label className="form-label small" htmlFor="p-phone">Phone</label><input id="p-phone" className="form-control" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </div>
      <div className="mt-3"><button className="btn btn-primary">Save changes</button></div>
    </form>
  );
}

function PasswordForm({ user, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirm) return setError(new Error('The new passwords do not match'));
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      onSaved();
      toast('Password changed');
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form className="card card-body mb-4" onSubmit={submit}>
      <h5 className="mb-1">{user.hasPassword ? 'Change password' : 'Set a password'}</h5>
      {!user.hasPassword && <p className="small text-muted">You signed in with Google or from guest checkout. Add a password to also sign in with your email.</p>}
      <ErrorAlert error={error} />
      <div className="row g-3">
        {user.hasPassword && <div className="col-md-4"><label className="form-label small" htmlFor="cp">Current password</label><input id="cp" type="password" autoComplete="current-password" className="form-control" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></div>}
        <div className="col-md-4"><label className="form-label small" htmlFor="np">New password</label><input id="np" type="password" autoComplete="new-password" className="form-control" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></div>
        <div className="col-md-4"><label className="form-label small" htmlFor="np2">Confirm new password</label><input id="np2" type="password" autoComplete="new-password" className="form-control" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
      </div>
      <div className="mt-3"><button className="btn btn-primary">Update password</button></div>
    </form>
  );
}

const EMPTY = { recipient: '', phone: '', addressLine: '', ward: '', district: '', city: '', isDefault: false };

function Addresses() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState(null);

  useEffect(() => { api.get('/profile/addresses').then((r) => setList(r.addresses)).catch(setError); }, []);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = editing === 'new' ? await api.post('/profile/addresses', draft) : await api.put(`/profile/addresses/${editing}`, draft);
      setList(r.addresses);
      setEditing(null);
      toast('Address saved');
    } catch (err) {
      setError(err);
    }
  };
  const act = async (fn, msg) => {
    try {
      const r = await fn();
      setList(r.addresses);
      toast(msg);
    } catch (err) {
      toast(err.message, 'danger');
    }
  };

  return (
    <div className="card card-body">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">Delivery addresses</h5>
        {editing === null && <button className="btn btn-sm btn-primary" onClick={() => { setDraft(EMPTY); setEditing('new'); }}><i className="bi bi-plus-lg me-1" />Add address</button>}
      </div>
      <ErrorAlert error={error} />
      {editing !== null && (
        <form className="border rounded p-3 mb-3 bg-light" onSubmit={save}>
          <AddressFields value={draft} onChange={setDraft} idPrefix="ab" />
          <div className="form-check mt-2"><input className="form-check-input" type="checkbox" id="def" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} /><label className="form-check-label small" htmlFor="def">Use as default address</label></div>
          <div className="mt-3 d-flex gap-2"><button className="btn btn-primary btn-sm">Save address</button><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button></div>
        </form>
      )}
      {!list && <Spinner />}
      {list && list.length === 0 && <EmptyState icon="geo-alt" title="No saved addresses" />}
      <div className="row g-3">
        {list?.map((a) => (
          <div className="col-md-6" key={a.id}>
            <div className={`border rounded p-3 h-100 ${a.isDefault ? 'border-primary' : ''}`}>
              <div className="d-flex justify-content-between">
                <b>{a.recipient}</b>
                {a.isDefault && <span className="badge text-bg-primary">Default</span>}
              </div>
              <div className="small text-muted">{a.phone}</div>
              <div className="small">{a.formatted}</div>
              <div className="d-flex gap-2 mt-2">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => { setDraft({ ...a, isDefault: a.isDefault }); setEditing(a.id); }}>Edit</button>
                {!a.isDefault && <button className="btn btn-sm btn-outline-primary" onClick={() => act(() => api.post(`/profile/addresses/${a.id}/default`), 'Default address updated')}>Set default</button>}
                <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => window.confirm('Delete this address?') && act(() => api.del(`/profile/addresses/${a.id}`), 'Address deleted')}><i className="bi bi-trash" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Profile() {
  const { user, setUser, refresh } = useAuth();
  useEffect(() => { document.title = 'My profile - TechHaven'; }, []);
  return (
    <>
      <h1 className="h4 mb-3">My profile</h1>
      <ProfileForm user={user} onSaved={(u) => setUser(u)} />
      <PasswordForm user={user} onSaved={refresh} />
      <Addresses />
    </>
  );
}

export function MyOrders() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  useEffect(() => { document.title = 'My orders - TechHaven'; }, []);
  useEffect(() => { setData(null); api.get(`/orders?page=${page}`).then(setData).catch(setError); }, [page]);

  return (
    <>
      <h1 className="h4 mb-3">My orders</h1>
      <ErrorAlert error={error} />
      {!data && !error && <Spinner />}
      {data && data.items.length === 0 && <EmptyState icon="receipt" title="No orders yet"><Link to="/products" className="btn btn-primary">Start shopping</Link></EmptyState>}
      <div className="vstack gap-3">
        {data?.items.map((o) => (
          <div key={o.id} className="card order-card" role="button" onClick={() => navigate(`/account/orders/${o.orderNumber}`)}>
            <div className="card-body">
              <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                <span className="fw-semibold">#{o.orderNumber}</span>
                <span className="small text-muted">{date(o.createdAt)}</span>
                <StatusBadge status={o.status} />
                <span className="ms-auto fw-bold">{vnd(o.total)}</span>
              </div>
              <ul className="small text-muted mb-0 ps-3">
                {o.items.map((i, idx) => <li key={idx}>{i.productName} ({i.variantName}) × {i.quantity}</li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </>
  );
}

export function MyOrderDetail() {
  const { number } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const toast = useToast();

  useEffect(() => {
    document.title = `Order ${number} - TechHaven`;
    api.get(`/orders/${number}`).then((r) => setOrder(r.order)).catch(setError);
  }, [number]);

  // The realtime service notifies the customer when the shop updates the status.
  useEffect(() => {
    const s = getSocket();
    const onStatus = (e) => {
      if (e.orderNumber !== number) return;
      toast(`Order ${e.orderNumber} is now ${e.status}`, 'info');
      api.get(`/orders/${number}`).then((r) => setOrder(r.order)).catch(() => {});
    };
    s.on('order:status', onStatus);
    return () => s.off('order:status', onStatus);
  }, [number, toast]);

  if (error) return <ErrorAlert error={error} />;
  if (!order) return <Spinner />;
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <Link to="/account/orders" className="btn btn-sm btn-link px-0"><i className="bi bi-arrow-left" /></Link>
        <h1 className="h4 mb-0">Order #{order.orderNumber}</h1>
        <StatusBadge status={order.status} />
      </div>
      <div className="card mb-3"><div className="card-body"><StatusProgress status={order.status} /></div></div>
      <div className="card mb-3"><div className="card-body"><OrderInfo order={order} /></div></div>
      <div className="row g-3">
        <div className="col-xl-8">
          <div className="card mb-3"><div className="card-body"><OrderItems order={order} /></div></div>
          <div className="card"><div className="card-header bg-white fw-semibold">Status history</div><div className="card-body"><OrderTimeline history={order.history} /></div></div>
        </div>
        <div className="col-xl-4"><div className="card"><div className="card-body"><OrderTotals order={order} /></div></div></div>
      </div>
    </>
  );
}
