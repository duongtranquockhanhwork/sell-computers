import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, DoughnutController, Filler, Legend,
  LineController, LineElement, LinearScale, PointElement, Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { api, qs } from '../../lib/api';
import { STATUS, dateTime, plural, short, vnd } from '../../lib/format';
import { ErrorAlert, Spinner, StatusBadge } from '../../components/common';

ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, LineController, LineElement, PointElement,
  DoughnutController, ArcElement, Tooltip, Legend, Filler);
ChartJS.defaults.maintainAspectRatio = false;
ChartJS.defaults.animation = false; // draw immediately, also on resize

// Charts need a sized parent when maintainAspectRatio is off.
const Box = ({ h = 300, children }) => <div style={{ position: 'relative', height: h }}>{children}</div>;

const C = { blue: '#0284c7', green: '#16a34a', amber: '#f59e0b', violet: '#7c3aed', rose: '#e11d48', slate: '#64748b', teal: '#0d9488' };
const PALETTE = [C.blue, C.green, C.amber, C.violet, C.rose, C.teal, C.slate, '#ea580c', '#4f46e5'];
const moneyAxis = { ticks: { callback: (v) => short(v) } };

function Kpi({ icon, label, value, sub, color = 'primary' }) {
  return (
    <div className="card kpi h-100">
      <div className="card-body d-flex gap-3 align-items-center">
        <div className={`kpi-icon bg-${color}-subtle text-${color} d-none d-sm-flex`}><i className={`bi bi-${icon}`} /></div>
        <div className="min-w-0">
          <div className="small text-muted">{label}</div>
          <div className="fs-4 fw-bold text-truncate" title={String(value)}>{value}</div>
          {sub && <div className="small text-muted">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// Actionable insights: what the shop owner should do next.
function NeedsAttention({ i }) {
  if (!i) return null;
  const tiles = [
    ['hourglass-split', 'warning', `${plural(i.toConfirm, 'order')} to confirm`, '/admin/orders?status=pending'],
    ['truck', 'primary', `${plural(i.toShip, 'order')} to ship`, '/admin/orders?status=confirmed'],
    ['exclamation-octagon', 'danger', `${i.outOfStock} variants out of stock`, '/admin/products?lowStock=true'],
    ['box-seam', 'secondary', `${i.lowStock} variants low on stock (1-5)`, '/admin/products?lowStock=true'],
  ];
  return (
    <div className="card mb-3 border-warning-subtle">
      <div className="card-body">
        <h6 className="mb-3"><i className="bi bi-lightbulb me-2 text-warning" />Needs attention</h6>
        <div className="row g-2 mb-2">
          {tiles.map(([icon, color, text, to]) => (
            <div className="col-6 col-xl-3" key={text}>
              <Link to={to} className={`insight-tile border-${color}-subtle`}><i className={`bi bi-${icon} text-${color}`} /><span>{text}</span></Link>
            </div>
          ))}
        </div>
        <div className="row g-3 small">
          <div className="col-lg-7">
            <div className="fw-semibold mb-1">Restock soon</div>
            {i.lowStockItems.length === 0 ? <div className="text-muted">All variants have more than 5 units.</div> : (
              <ul className="list-unstyled mb-0">
                {i.lowStockItems.map((x) => (
                  <li key={`${x.productId}-${x.variant}`} className="d-flex justify-content-between border-bottom py-1">
                    <Link to={`/admin/products/${x.productId}`} className="text-truncate d-block min-w-0 me-2" title={`${x.product} (${x.variant})`}>{x.product} <span className="text-muted">({x.variant})</span></Link>
                    <span className={`badge flex-shrink-0 align-self-center ${x.stock === 0 ? 'text-bg-danger' : 'text-bg-warning'}`}>{x.stock} left</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="col-lg-5">
            <div className="fw-semibold mb-1">Discount codes almost used up</div>
            {i.codesNearlyUsed.length === 0 ? <div className="text-muted">No code is close to its limit.</div> : (
              <div className="d-flex flex-wrap gap-1">
                {i.codesNearlyUsed.map((c) => <Link key={c.code} to="/admin/discounts" className="badge text-bg-light text-decoration-none font-monospace">{c.code} · {c.left} left</Link>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { api.get('/admin/dashboard/summary').then(setD).catch(setError); }, []);
  if (error) return <ErrorAlert error={error} />;
  if (!d) return <Spinner />;
  const statuses = Object.keys(STATUS);
  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-6 col-xl-3"><Kpi icon="people" label="Total customers" value={d.users.total.toLocaleString()} sub={`${d.users.newThisMonth} new this month`} /></div>
        <div className="col-6 col-xl-3"><Kpi icon="person-plus" label="New users (30 days)" value={d.users.new30d} color="info" /></div>
        <div className="col-6 col-xl-3"><Kpi icon="receipt" label="Orders" value={d.orders.total.toLocaleString()} sub={`${d.orders.last30d} in the last 30 days · ${d.orders.pending} pending`} color="warning" /></div>
        <div className="col-6 col-xl-3"><Kpi icon="cash-coin" label="Revenue" value={`${short(d.orders.revenue)}₫`} sub={`${short(d.orders.revenue30d)}₫ last 30 days`} color="success" /></div>
      </div>
      <NeedsAttention i={d.insights} />
      <div className="row g-3 mb-3">
        <div className="col-xl-8">
          <div className="card h-100"><div className="card-body">
            <h6>Revenue & orders - last 12 months</h6>
            <Box><Bar
              data={{
                labels: d.monthly.map((m) => m.month),
                datasets: [
                  { type: 'bar', label: 'Revenue (₫)', data: d.monthly.map((m) => m.revenue), backgroundColor: C.blue, yAxisID: 'y', borderRadius: 4 },
                  { type: 'line', label: 'Orders', data: d.monthly.map((m) => m.orders), borderColor: C.amber, backgroundColor: C.amber, yAxisID: 'y1', tension: 0.3 },
                ],
              }}
              options={{ responsive: true, interaction: { mode: 'index', intersect: false }, scales: { y: moneyAxis, y1: { position: 'right', grid: { drawOnChartArea: false } } } }}
            /></Box>
          </div></div>
        </div>
        <div className="col-xl-4">
          <div className="card h-100"><div className="card-body">
            <h6>Orders by status</h6>
            <Box><Doughnut
              data={{ labels: statuses.map((s) => STATUS[s].label), datasets: [{ data: statuses.map((s) => d.byStatus[s] || 0), backgroundColor: [C.amber, '#0dcaf0', C.blue, C.green, C.slate] }] }}
              options={{ plugins: { legend: { position: 'bottom' } } }}
            /></Box>
          </div></div>
        </div>
      </div>
      <div className="row g-3">
        <div className="col-xl-7">
          <div className="card h-100"><div className="card-body">
            <h6>Best-selling products (units)</h6>
            <Box><Bar
              data={{ labels: d.bestSellers.map((b) => (b.name.length > 28 ? `${b.name.slice(0, 28)}…` : b.name)), datasets: [{ label: 'Units sold', data: d.bestSellers.map((b) => b.quantity), backgroundColor: C.green, borderRadius: 4 }] }}
              options={{ indexAxis: 'y', plugins: { legend: { display: false } } }}
            /></Box>
          </div></div>
        </div>
        <div className="col-xl-5">
          <div className="card h-100"><div className="card-body">
            <div className="d-flex justify-content-between"><h6>Latest orders</h6><Link to="/admin/orders" className="small">View all</Link></div>
            <table className="table table-sm align-middle mb-0">
              <tbody>
                {d.latestOrders.map((o) => (
                  <tr key={o.orderNumber}>
                    <td><Link to={`/admin/orders/${o.orderNumber}`} className="small fw-semibold">{o.orderNumber}</Link><div className="small text-muted">{o.fullName} · {dateTime(o.createdAt)}</div></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="text-end small fw-semibold">{vnd(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
    </>
  );
}

const GRANULARITIES = [['year', 'Yearly'], ['quarter', 'Quarterly'], ['month', 'Monthly'], ['week', 'Weekly'], ['custom', 'Custom range']];

function AdvancedDashboard() {
  const [g, setG] = useState('year');
  const [range, setRange] = useState({ from: '', to: '', granularity: 'day' });
  const [applied, setApplied] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (g === 'custom' && !applied) return;
    setD(null);
    setError(null);
    const params = g === 'custom' ? { granularity: applied.granularity, from: applied.from, to: applied.to } : { granularity: g };
    api.get(`/admin/dashboard/advanced${qs(params)}`).then(setD).catch(setError);
  }, [g, applied]);

  const labels = d?.series.map((s) => s.label) || [];
  return (
    <>
      <div className="card mb-3">
        <div className="card-body d-flex flex-wrap gap-2 align-items-end">
          <div className="btn-group flex-wrap" role="group" aria-label="Time interval">
            {GRANULARITIES.map(([k, label]) => (
              <button key={k} className={`btn btn-sm ${g === k ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setG(k)}>{label}</button>
            ))}
          </div>
          {g === 'custom' && (
            <form className="d-flex flex-wrap gap-2 align-items-end" onSubmit={(e) => { e.preventDefault(); setApplied({ ...range }); }}>
              <div><label className="form-label small mb-0" htmlFor="from">Start</label><input id="from" type="date" required className="form-control form-control-sm" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
              <div><label className="form-label small mb-0" htmlFor="to">End</label><input id="to" type="date" required className="form-control form-control-sm" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
              <div><label className="form-label small mb-0" htmlFor="grp">Group by</label>
                <select id="grp" className="form-select form-select-sm" value={range.granularity} onChange={(e) => setRange({ ...range, granularity: e.target.value })}>
                  <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
                </select>
              </div>
              <button className="btn btn-sm btn-primary">Apply</button>
            </form>
          )}
          {d && <div className="ms-auto small text-muted">{d.from} → {d.to}</div>}
        </div>
      </div>
      <ErrorAlert error={error} />
      {g === 'custom' && !applied && <div className="text-muted small">Choose a start and end date, then press Apply.</div>}
      {!d && !error && (g !== 'custom' || applied) && <Spinner />}
      {d && (
        <>
          <div className="row g-3 mb-3">
            <div className="col-6 col-xl-3"><Kpi icon="receipt" label="Orders sold" value={d.totals.orders.toLocaleString()} color="warning" /></div>
            <div className="col-6 col-xl-3"><Kpi icon="cash-coin" label="Total revenue" value={`${short(d.totals.revenue)}₫`} sub={vnd(d.totals.revenue)} color="success" /></div>
            <div className="col-6 col-xl-3"><Kpi icon="graph-up-arrow" label="Overall profit" value={`${short(d.totals.profit)}₫`} sub={vnd(d.totals.profit)} color="primary" /></div>
            <div className="col-6 col-xl-3"><Kpi icon="box" label="Products sold" value={d.totals.quantity.toLocaleString()} sub="units" color="info" /></div>
          </div>
          <div className="row g-3 mb-3">
            <div className="col-xl-8"><div className="card h-100"><div className="card-body">
              <h6>Revenue vs profit</h6>
              <Box><Bar data={{ labels, datasets: [
                { label: 'Revenue (₫)', data: d.series.map((s) => s.revenue), backgroundColor: C.blue, borderRadius: 4 },
                { label: 'Profit (₫)', data: d.series.map((s) => s.profit), backgroundColor: C.green, borderRadius: 4 },
              ] }} options={{ interaction: { mode: 'index', intersect: false }, scales: { y: moneyAxis } }} /></Box>
            </div></div></div>
            <div className="col-xl-4"><div className="card h-100"><div className="card-body">
              <h6>Orders per period</h6>
              <Box><Line data={{ labels, datasets: [{ label: 'Orders', data: d.series.map((s) => s.orders), borderColor: C.amber, backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: 0.3 }] }} options={{ plugins: { legend: { display: false } } }} /></Box>
            </div></div></div>
          </div>
          <div className="row g-3 mb-3">
            <div className="col-xl-6"><div className="card h-100"><div className="card-body">
              <h6>Number of products & product types sold</h6>
              <Box><Bar data={{ labels, datasets: [
                { label: 'Units sold', data: d.series.map((s) => s.quantity), backgroundColor: C.violet, yAxisID: 'y', borderRadius: 4 },
                { type: 'line', label: 'Product types (categories)', data: d.series.map((s) => s.productTypes), borderColor: C.rose, backgroundColor: C.rose, yAxisID: 'y1' },
                { type: 'line', label: 'Distinct products', data: d.series.map((s) => s.distinctProducts), borderColor: C.teal, backgroundColor: C.teal, yAxisID: 'y1' },
              ] }} options={{ interaction: { mode: 'index', intersect: false }, scales: { y1: { position: 'right', grid: { drawOnChartArea: false } } } }} /></Box>
            </div></div></div>
            <div className="col-xl-6"><div className="card h-100"><div className="card-body">
              <h6>Revenue by product type</h6>
              <Box><Bar data={{ labels: d.categories.map((c) => c.name), datasets: [
                { label: 'Revenue (₫)', data: d.categories.map((c) => c.revenue), backgroundColor: PALETTE, borderRadius: 4 },
              ] }} options={{ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: moneyAxis } }} /></Box>
            </div></div></div>
          </div>
          <div className="card"><div className="card-body table-responsive">
            <h6>Breakdown by {d.granularity}</h6>
            <table className="table table-sm table-striped align-middle mb-0">
              <thead><tr><th>Period</th><th className="text-end">Orders</th><th className="text-end">Revenue</th><th className="text-end">Profit</th><th className="text-end">Margin</th><th className="text-end">Units</th><th className="text-end">Product types</th></tr></thead>
              <tbody>
                {d.series.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td><td className="text-end">{s.orders}</td><td className="text-end">{vnd(s.revenue)}</td><td className="text-end">{vnd(s.profit)}</td>
                    <td className="text-end">{s.revenue ? `${((s.profit / s.revenue) * 100).toFixed(1)}%` : '-'}</td><td className="text-end">{s.quantity}</td><td className="text-end">{s.productTypes}</td>
                  </tr>
                ))}
                {d.series.length === 0 && <tr><td colSpan={7} className="text-center text-muted">No sales in this period</td></tr>}
              </tbody>
            </table>
          </div></div>
        </>
      )}
    </>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState('simple');
  useEffect(() => { document.title = 'Dashboard - TechHaven Admin'; }, []);
  return (
    <>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h1 className="h4 mb-0">Dashboard</h1>
        <ul className="nav nav-pills">
          <li className="nav-item"><button className={`nav-link ${tab === 'simple' ? 'active' : ''}`} onClick={() => setTab('simple')}>Overview</button></li>
          <li className="nav-item"><button className={`nav-link ${tab === 'advanced' ? 'active' : ''}`} onClick={() => setTab('advanced')}>Advanced analytics</button></li>
        </ul>
      </div>
      {tab === 'simple' ? <SimpleDashboard /> : <AdvancedDashboard />}
    </>
  );
}
