import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { usePageMeta } from '../lib/seo';
import { recentlyViewed } from '../lib/shopping';
import { PagedProducts } from '../components/common';

const ICONS = { laptop: 'laptop', desktop: 'pc-display', monitor: 'display', cpu: 'cpu', gpu: 'gpu-card', ram: 'memory', storage: 'device-ssd', motherboard: 'motherboard', psu: 'plug' };

const SLIDES = [
  { title: 'Build, upgrade and game with TechHaven', text: 'Laptops, desktop PCs, monitors and every component you need - free shipping from 5,000,000₫ and 10% back in loyalty points.', cta: ['Shop all products', '/products'], cta2: ['Graphics cards', '/category/graphics-cards'], tone: 'slide-a' },
  { title: 'Hot deals on genuine hardware', text: 'Up to 30% off selected CPUs, motherboards, power supplies and more - while stocks last.', cta: ['See all deals', '/products?onSale=true&sort=discount'], cta2: ['Processors', '/category/processors'], tone: 'slide-b' },
  { title: 'Not sure what to buy?', text: 'Tell our AI assistant your budget and how you will use it - it suggests matching products from our catalogue in seconds.', cta: ['Gaming laptops', '/products?category=laptops&tag=gaming'], cta2: ['Creator gear', '/products?tag=creator'], tone: 'slide-c' },
];

const NEEDS = [
  ['controller', 'Gaming', '/products?tag=gaming'], ['briefcase', 'Office', '/products?tag=office'],
  ['mortarboard', 'Students', '/products?tag=student'], ['palette', 'Creators', '/products?tag=creator'],
  ['pc-display-horizontal', 'Workstation', '/products?tag=workstation'], ['piggy-bank', 'Budget picks', '/products?tag=budget&sort=price_asc'],
];

function Hero() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, [paused]);
  const s = SLIDES[i];
  return (
    <section className={`hero ${s.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carousel">
      <div className="container py-5">
        <div className="row align-items-center g-4">
          <div className="col-lg-7" key={i} style={{ animation: 'fadeIn .4s' }}>
            <span className="badge text-bg-info mb-3">Genuine products · Official warranty</span>
            <h1 className="display-5 fw-bold text-white">{s.title}</h1>
            <p className="lead text-white-50">{s.text}</p>
            <div className="d-flex gap-2 flex-wrap">
              <Link to={s.cta[1]} className="btn btn-info btn-lg">{s.cta[0]}</Link>
              <Link to={s.cta2[1]} className="btn btn-outline-light btn-lg">{s.cta2[0]}</Link>
            </div>
          </div>
          <div className="col-lg-5 d-none d-lg-block">
            <div className="hero-perks">
              {[['truck', 'Fast nationwide delivery'], ['shield-check', 'Up to 36-month warranty'], ['gem', '10% loyalty points'], ['person-check', 'Checkout without an account']].map(([ic, t]) => (
                <div key={t} className="perk"><i className={`bi bi-${ic}`} /><span>{t}</span></div>
              ))}
            </div>
          </div>
        </div>
        <div className="hero-dots">
          {SLIDES.map((x, k) => <button key={x.title} className={k === i ? 'active' : ''} onClick={() => setI(k)} aria-label={`Slide ${k + 1}`} />)}
        </div>
      </div>
    </section>
  );
}

function Section({ title, icon, link, query, items, perPage = 4, extra }) {
  return (
    <section className="my-5">
      <div className="d-flex align-items-center justify-content-between mb-3 gap-2 flex-wrap">
        <h2 className="section-title"><i className={`bi bi-${icon} me-2 text-primary`} />{title}</h2>
        <div className="d-flex align-items-center gap-2">{extra}{link && <Link to={link} className="btn btn-sm btn-link">View all <i className="bi bi-arrow-right" /></Link>}</div>
      </div>
      <PagedProducts query={query} items={items} perPage={perPage} />
    </section>
  );
}

// Section with brand tabs, like the category blocks of large electronics stores.
function CategorySection({ cat }) {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState('');
  useEffect(() => { api.get(`/brands?category=${cat.slug}`).then((r) => setBrands(r.brands.slice(0, 5))).catch(() => {}); }, [cat.slug]);
  const tabs = (
    <div className="brand-tabs d-none d-md-flex">
      <button className={!brand ? 'active' : ''} onClick={() => setBrand('')}>All</button>
      {brands.map((b) => <button key={b.name} className={brand === b.name ? 'active' : ''} onClick={() => setBrand(b.name)}>{b.name}</button>)}
    </div>
  );
  return (
    <Section title={cat.name} icon={ICONS[cat.icon] || 'box'} link={`/category/${cat.slug}`} extra={tabs}
      query={{ category: cat.slug, brand: brand || undefined, sort: 'best_selling' }} />
  );
}

export default function Home() {
  const [cats, setCats] = useState([]);
  const [brands, setBrands] = useState([]);
  const [recent, setRecent] = useState([]);
  usePageMeta({});

  useEffect(() => {
    api.get('/categories').then((r) => setCats(r.categories)).catch(() => {});
    api.get('/brands').then((r) => setBrands(r.brands)).catch(() => {});
    const slugs = recentlyViewed();
    if (slugs.length) api.get(`/products/by-slugs?slugs=${slugs.join(',')}`).then((r) => setRecent(r.items)).catch(() => {});
  }, []);

  const sectionCats = ['laptops', 'desktop-pcs', 'monitors', 'graphics-cards', 'storage'].map((s) => cats.find((c) => c.slug === s)).filter(Boolean);

  return (
    <>
      <Hero />
      <div className="container">
        <section className="my-4">
          <div className="row g-2 row-cols-3 row-cols-md-5 row-cols-xl-9">
            {cats.map((c) => (
              <div className="col" key={c.slug}>
                <Link to={`/category/${c.slug}`} className="cat-tile">
                  <i className={`bi bi-${ICONS[c.icon] || 'box'}`} />
                  <span>{c.name}</span>
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="my-4">
          <h2 className="section-title mb-3"><i className="bi bi-compass me-2 text-primary" />Shop by need</h2>
          <div className="row g-2 row-cols-2 row-cols-md-3 row-cols-xl-6">
            {NEEDS.map(([icon, label, to]) => (
              <div className="col" key={label}><Link to={to} className="need-tile"><i className={`bi bi-${icon}`} /><span>{label}</span></Link></div>
            ))}
          </div>
        </section>

        <Section title="Hot Deals" icon="lightning-charge" link="/products?onSale=true&sort=discount" query={{ onSale: 'true', sort: 'discount' }} />
        <Section title="New Products" icon="stars" link="/products?sort=newest" query={{ sort: 'newest' }} />
        <Section title="Best Sellers" icon="fire" link="/products?sort=best_selling" query={{ sort: 'best_selling' }} />
        {sectionCats.map((c) => <CategorySection key={c.slug} cat={c} />)}

        {brands.length > 0 && (
          <section className="my-5">
            <h2 className="section-title mb-3"><i className="bi bi-award me-2 text-primary" />Shop by brand</h2>
            <div className="brand-strip">
              {brands.map((b) => <Link key={b.name} to={`/products?brand=${encodeURIComponent(b.name)}`} className="brand-pill">{b.name}<span>{b.count}</span></Link>)}
            </div>
          </section>
        )}

        {recent.length > 0 && <Section title="Recently viewed" icon="clock-history" items={recent} />}
      </div>
    </>
  );
}
