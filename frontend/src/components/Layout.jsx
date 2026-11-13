import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { useShopping } from '../lib/shopping';
import { CompareBar, FloatingWidgets, MiniCart } from './Widgets';
import { vnd } from '../lib/format';

function SearchBox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (location.pathname === '/products') setQ(params.get('q') || '');
  }, [location]);

  useEffect(() => {
    if (q.trim().length < 2) return setSuggestions([]);
    const t = setTimeout(() => {
      api.get(`/search/suggest?q=${encodeURIComponent(q.trim())}`).then((r) => setSuggestions(r.suggestions || [])).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    setOpen(false);
    navigate(`/products?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <form className="search-box position-relative flex-grow-1" onSubmit={submit} ref={boxRef} role="search">
      <div className="input-group">
        <input
          className="form-control"
          type="search"
          placeholder="Search laptops, GPUs, SSDs..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label="Search products"
        />
        <button className="btn btn-primary" type="submit" aria-label="Search"><i className="bi bi-search" /></button>
      </div>
      {open && suggestions.length > 0 && (
        <div className="list-group position-absolute w-100 shadow suggest-list">
          {suggestions.map((s) => (
            <Link key={s.slug} to={`/products/${s.slug}`} className="list-group-item list-group-item-action d-flex justify-content-between" onClick={() => setOpen(false)}>
              <span className="text-truncate">{s.name}</span>
              {s.price ? <span className="text-muted small ms-2 text-nowrap">{vnd(s.price)}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </form>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { wishIds } = useShopping();
  const navigate = useNavigate();
  const [cats, setCats] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { api.get('/categories').then((r) => setCats(r.categories)).catch(() => {}); }, []);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="site-header sticky-top">
      <div className="topbar d-none d-md-block">
        <div className="container d-flex justify-content-between small">
          <span><i className="bi bi-truck me-1" /> Free shipping on orders from 5,000,000₫</span>
          <span><i className="bi bi-gift me-1" /> Earn 10% back as loyalty points on every order</span>
          <span className="d-flex gap-3">
            <Link to="/track-order" className="text-reset text-decoration-none"><i className="bi bi-truck me-1" />Track order</Link>
            <a href="tel:19000000" className="text-reset text-decoration-none"><i className="bi bi-telephone me-1" />1900 0000</a>
          </span>
        </div>
      </div>
      <nav className="navbar navbar-dark navbar-expand-lg">
        <div className="container gap-2 gap-lg-3">
          <Link to="/" className="navbar-brand fw-bold fs-4 me-0">Tech<span className="text-info">Haven</span></Link>
          <div className="d-none d-lg-flex flex-grow-1"><SearchBox /></div>
          <div className="d-flex align-items-center gap-1 ms-auto">
            <Link to="/wishlist" className="btn btn-link text-white position-relative" aria-label="Wish list">
              <i className="bi bi-heart fs-5" />
              {wishIds.length > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{wishIds.length}</span>}
            </Link>
            <Link to="/cart" className="btn btn-link text-white position-relative" aria-label="Shopping cart">
              <i className="bi bi-cart3 fs-5" />
              {count > 0 && <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">{count}</span>}
            </Link>
            {user ? (
              <div className="dropdown">
                <button className="btn btn-link text-white dropdown-toggle text-decoration-none" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
                  <i className="bi bi-person-circle fs-5" /> <span className="d-none d-md-inline">{user.fullName.split(' ').slice(-1)[0]}</span>
                </button>
                <ul className={`dropdown-menu dropdown-menu-end ${menuOpen ? 'show' : ''}`}>
                  <li className="dropdown-header">{user.email}</li>
                  {user.role === 'admin' && <li><Link className="dropdown-item" to="/admin"><i className="bi bi-speedometer2 me-2" />Admin dashboard</Link></li>}
                  <li><Link className="dropdown-item" to="/account"><i className="bi bi-person me-2" />My profile</Link></li>
                  <li><Link className="dropdown-item" to="/account/orders"><i className="bi bi-receipt me-2" />My orders</Link></li>
                  <li><span className="dropdown-item-text small text-muted"><i className="bi bi-gem me-2" />{user.loyaltyPoints} points</span></li>
                  <li><hr className="dropdown-divider" /></li>
                  <li><button className="dropdown-item" onClick={async () => { await logout(); navigate('/'); }}><i className="bi bi-box-arrow-right me-2" />Sign out</button></li>
                </ul>
              </div>
            ) : (
              <Link to="/login" className="btn btn-outline-light btn-sm">Sign in</Link>
            )}
          </div>
          <div className="w-100 d-lg-none"><SearchBox /></div>
        </div>
      </nav>
      <div className="catbar">
        <div className="container d-flex gap-1 overflow-auto">
          <NavLink to="/products" end className="catbar-link">All products</NavLink>
          {cats.map((c) => (
            <NavLink key={c.slug} to={`/category/${c.slug}`} className="catbar-link">{c.name}</NavLink>
          ))}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer mt-5">
      <div className="container py-5">
        <div className="row g-4">
          <div className="col-md-4">
            <div className="fw-bold fs-5 mb-2 text-white">Tech<span className="text-info">Haven</span></div>
            <p className="small">Computers and computer components with genuine warranty, fast delivery and expert advice.</p>
          </div>
          <div className="col-6 col-md-2">
            <h6 className="text-white">Shop</h6>
            <ul className="list-unstyled small">
              <li><Link to="/category/laptops">Laptops</Link></li>
              <li><Link to="/category/desktop-pcs">Desktop PCs</Link></li>
              <li><Link to="/category/graphics-cards">Graphics cards</Link></li>
              <li><Link to="/category/storage">Storage</Link></li>
            </ul>
          </div>
          <div className="col-6 col-md-3">
            <h6 className="text-white">Customer care</h6>
            <ul className="list-unstyled small">
              <li><Link to="/track-order">Track an order</Link></li>
              <li><Link to="/wishlist">Wish list</Link></li>
              <li><Link to="/compare">Compare products</Link></li>
              <li><Link to="/cart">Shopping cart</Link></li>
              <li><Link to="/forgot-password">Recover password</Link></li>
            </ul>
          </div>
          <div className="col-md-3 small">
            <h6 className="text-white">Contact</h6>
            <div><i className="bi bi-geo-alt me-2" />19 Nguyen Huu Tho, District 7, HCMC</div>
            <div><i className="bi bi-telephone me-2" />1900 0000</div>
            <div><i className="bi bi-clock me-2" />8:00 - 21:00 daily</div>
          </div>
        </div>
        <hr className="border-secondary" />
        <div className="small">© {new Date().getFullYear()} TechHaven. Final project - Web Programming with Node.js (502070).</div>
      </div>
    </footer>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="d-flex flex-column min-vh-100">
      <Header />
      <main className="flex-grow-1">
        <Outlet />
      </main>
      <Footer />
      <MiniCart />
      <CompareBar />
      <FloatingWidgets />
    </div>
  );
}
