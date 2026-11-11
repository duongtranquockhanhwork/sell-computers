import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { getSocket } from '../../lib/socket';
import { useToast } from '../../lib/toast';
import { vnd } from '../../lib/format';
import { Spinner } from '../../components/common';

const NAV = [
  ['/admin', 'speedometer2', 'Dashboard', true],
  ['/admin/products', 'box-seam', 'Products'],
  ['/admin/categories', 'tags', 'Categories'],
  ['/admin/orders', 'receipt', 'Orders'],
  ['/admin/users', 'people', 'Users'],
  ['/admin/discounts', 'percent', 'Discount codes'],
];

export default function AdminLayout() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    const s = getSocket();
    const onOrder = (o) => toast(`New order ${o.orderNumber} · ${vnd(o.total)}`, 'info');
    s.on('order:new', onOrder);
    return () => s.off('order:new', onOrder);
  }, [user, toast]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login?redirect=/admin" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${open ? 'open' : ''}`}>
        <Link to="/admin" className="d-block fw-bold fs-5 text-white text-decoration-none px-3 py-3">Tech<span className="text-info">Haven</span> <span className="badge text-bg-info fs-7">Admin</span></Link>
        <nav className="nav flex-column px-2">
          {NAV.map(([to, icon, label, end]) => (
            <NavLink key={to} to={to} end={end} className="nav-link"><i className={`bi bi-${icon} me-2`} />{label}</NavLink>
          ))}
        </nav>
        <div className="mt-auto p-3 small">
          <Link to="/" className="d-block text-white-50 mb-2"><i className="bi bi-shop me-2" />View store</Link>
          <button className="btn btn-sm btn-outline-light w-100" onClick={logout}><i className="bi bi-box-arrow-right me-1" />Sign out</button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <button className="btn btn-link d-lg-none" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu"><i className="bi bi-list fs-4" /></button>
          <div className="ms-auto small text-muted"><i className="bi bi-person-badge me-1" />{user.fullName}</div>
        </header>
        <div className="p-3 p-md-4"><Outlet /></div>
      </div>
      {open && <div className="admin-backdrop d-lg-none" onClick={() => setOpen(false)} />}
    </div>
  );
}
