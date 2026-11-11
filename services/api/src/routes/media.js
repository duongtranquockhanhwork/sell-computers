// Serves uploaded images (stored in PostgreSQL) and deterministic SVG product
// illustrations used by the seed catalogue, so the demo works fully offline.
const express = require('express');
const db = require('../db');
const v = require('../lib/http');

const router = express.Router();

router.get('/media/:id', async (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const { rows } = await db.query('SELECT mime, data FROM media WHERE id = $1', [id]);
  if (!rows.length) throw v.notFound('Image not found');
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(rows[0].data);
});

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// Simple line drawings per category. Coordinates assume a 400x300 canvas.
const ICONS = {
  laptop: (c) => `<rect x="110" y="70" width="180" height="115" rx="8" fill="#1f2937" stroke="${c}" stroke-width="4"/>
    <rect x="122" y="82" width="156" height="91" rx="3" fill="${c}" opacity=".35"/>
    <path d="M85 195 h230 l-18 22 h-194 z" fill="#374151"/><rect x="180" y="198" width="40" height="5" rx="2" fill="#9ca3af"/>`,
  desktop: (c) => `<rect x="150" y="55" width="100" height="175" rx="10" fill="#111827" stroke="${c}" stroke-width="4"/>
    <circle cx="200" cy="85" r="9" fill="${c}"/><rect x="168" y="110" width="64" height="6" rx="3" fill="#4b5563"/>
    <rect x="168" y="124" width="64" height="6" rx="3" fill="#4b5563"/><circle cx="200" cy="180" r="28" fill="none" stroke="${c}" stroke-width="3" opacity=".7"/>`,
  monitor: (c) => `<rect x="85" y="60" width="230" height="140" rx="8" fill="#111827" stroke="${c}" stroke-width="4"/>
    <rect x="97" y="72" width="206" height="116" rx="3" fill="${c}" opacity=".35"/><rect x="190" y="200" width="20" height="25" fill="#4b5563"/>
    <rect x="150" y="225" width="100" height="8" rx="4" fill="#4b5563"/>`,
  cpu: (c) => `<rect x="130" y="80" width="140" height="140" rx="10" fill="#1f2937" stroke="${c}" stroke-width="4"/>
    <rect x="160" y="110" width="80" height="80" rx="6" fill="${c}" opacity=".5"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${142 + i * 22}" y="62" width="6" height="16" fill="#9ca3af"/><rect x="${142 + i * 22}" y="222" width="6" height="16" fill="#9ca3af"/>`).join('')}`,
  gpu: (c) => `<rect x="70" y="100" width="260" height="100" rx="12" fill="#111827" stroke="${c}" stroke-width="4"/>
    <circle cx="145" cy="150" r="36" fill="none" stroke="${c}" stroke-width="4"/><circle cx="255" cy="150" r="36" fill="none" stroke="${c}" stroke-width="4"/>
    <circle cx="145" cy="150" r="8" fill="${c}"/><circle cx="255" cy="150" r="8" fill="${c}"/><rect x="90" y="200" width="150" height="12" fill="#d4a017"/>`,
  ram: (c) => `<rect x="60" y="115" width="280" height="70" rx="6" fill="#065f46" stroke="${c}" stroke-width="4"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${76 + i * 32}" y="128" width="22" height="34" rx="2" fill="#111827"/>`).join('')}
    <rect x="60" y="185" width="280" height="10" fill="#d4a017"/>`,
  storage: (c) => `<rect x="105" y="85" width="190" height="130" rx="12" fill="#1f2937" stroke="${c}" stroke-width="4"/>
    <rect x="125" y="105" width="110" height="20" rx="4" fill="${c}" opacity=".6"/><rect x="125" y="135" width="150" height="8" rx="4" fill="#4b5563"/>
    <rect x="125" y="150" width="120" height="8" rx="4" fill="#4b5563"/><circle cx="270" cy="190" r="6" fill="#22c55e"/>`,
  motherboard: (c) => `<rect x="95" y="55" width="210" height="190" rx="8" fill="#0f172a" stroke="${c}" stroke-width="4"/>
    <rect x="165" y="80" width="60" height="60" rx="4" fill="${c}" opacity=".5"/><rect x="240" y="75" width="10" height="90" fill="#4b5563"/>
    <rect x="258" y="75" width="10" height="90" fill="#4b5563"/><rect x="115" y="170" width="170" height="10" fill="#4b5563"/><rect x="115" y="195" width="170" height="10" fill="#4b5563"/>`,
  psu: (c) => `<rect x="100" y="80" width="200" height="140" rx="10" fill="#111827" stroke="${c}" stroke-width="4"/>
    <circle cx="200" cy="150" r="50" fill="none" stroke="${c}" stroke-width="4"/>
    ${[0, 1, 2, 3].map((i) => `<line x1="200" y1="150" x2="${200 + 45 * Math.cos(i * 0.785 * 2)}" y2="${150 + 45 * Math.sin(i * 0.785 * 2)}" stroke="${c}" stroke-width="3"/>`).join('')}`,
  box: (c) => `<rect x="120" y="80" width="160" height="140" rx="10" fill="#1f2937" stroke="${c}" stroke-width="4"/>`,
};

// /api/media/gen/:icon/:hue/:view.svg?t=Title&b=Brand
router.get('/media/gen/:icon/:hue/:view.svg', (req, res) => {
  const icon = ICONS[req.params.icon] ? req.params.icon : 'box';
  const hue = Math.abs(Number(req.params.hue) || 0) % 360;
  const view = Math.abs(Number(req.params.view) || 0) % 4;
  const title = esc(String(req.query.t || '').slice(0, 42));
  const brand = esc(String(req.query.b || '').slice(0, 20));
  const accent = `hsl(${hue} 85% 60%)`;
  const bg1 = `hsl(${hue} 45% ${[16, 22, 12, 19][view]}%)`;
  const bg2 = `hsl(${(hue + 40) % 360} 55% ${[32, 38, 26, 30][view]}%)`;
  const transform = ['', 'rotate(-8 200 150) translate(0 6)', 'scale(1.25) translate(-40 -40)', 'rotate(6 200 150)'][view];
  const caption = ['', 'Angle view', 'Detail view', 'Side view'][view];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="800" height="600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="400" height="300" fill="url(#g)"/>
  <circle cx="330" cy="50" r="90" fill="${accent}" opacity=".08"/><circle cx="60" cy="270" r="70" fill="${accent}" opacity=".08"/>
  <g transform="${transform}">${ICONS[icon](accent)}</g>
  <text x="16" y="28" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="#fff" opacity=".9">${brand}</text>
  <text x="16" y="284" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#fff" opacity=".85">${title}</text>
  <text x="384" y="284" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="11" fill="#fff" opacity=".6">${caption}</text>
</svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

module.exports = router;
