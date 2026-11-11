// Sends N requests through the gateway and counts which API replica answered.
// Usage: node tests/scale-demo.mjs [requests] [baseUrl]
const n = Number(process.argv[2] || 60);
const base = (process.argv[3] || 'http://localhost:8080').replace(/\/$/, '');
const counts = {};
const t0 = Date.now();
await Promise.all(Array.from({ length: n }, async () => {
  const r = await fetch(`${base}/api/health`);
  const id = r.headers.get('x-instance');
  counts[id] = (counts[id] || 0) + 1;
}));
console.log(`${n} requests in ${Date.now() - t0} ms`);
for (const [id, c] of Object.entries(counts).sort()) console.log(`  replica ${id}: ${c} requests`);
