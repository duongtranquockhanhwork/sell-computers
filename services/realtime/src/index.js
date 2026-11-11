// Realtime service: browsers keep a WebSocket open here; the API never talks to
// sockets directly. It publishes events on a Redis channel and every replica of
// this service relays them to its own connected clients (decoupled, scalable).
const http = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const PORT = Number(process.env.PORT || 4000);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'techhaven-dev-secret-change-me';
const CHANNEL = 'techhaven:realtime';
const INSTANCE = process.env.HOSTNAME || 'realtime-local';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', instance: INSTANCE, clients: io.engine.clientsCount }));
  }
  res.writeHead(404).end();
});

const io = new Server(server, {
  path: '/socket.io',
  // WebSocket-only transport means no sticky sessions are needed behind the load balancer.
  transports: ['websocket'],
  cors: { origin: false },
});

// Identify signed-in users from the same httpOnly cookie the API issues.
io.use((socket, next) => {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || '');
    if (cookies.th_token) socket.data.user = jwt.verify(cookies.th_token, JWT_SECRET);
  } catch {
    socket.data.user = null;
  }
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  if (user) {
    socket.join(`user:${user.sub}`);
    if (user.role === 'admin') socket.join('admin');
  }
  socket.on('product:join', (productId) => {
    const id = Number(productId);
    if (Number.isInteger(id) && id > 0) socket.join(`product:${id}`);
  });
  socket.on('product:leave', (productId) => socket.leave(`product:${Number(productId)}`));
});

const sub = new Redis(REDIS_URL);
sub.on('error', (e) => console.error('[realtime] redis', e.message));
sub.subscribe(CHANNEL, (err) => {
  if (err) console.error('[realtime] subscribe failed', err.message);
  else console.log(`[realtime] subscribed to ${CHANNEL}`);
});
sub.on('message', (_channel, raw) => {
  try {
    const { room, event, payload } = JSON.parse(raw);
    if (typeof room === 'string' && typeof event === 'string') io.local.to(room).emit(event, payload);
  } catch (err) {
    console.error('[realtime] bad message', err.message);
  }
});

server.listen(PORT, () => console.log(`[realtime] ${INSTANCE} listening on :${PORT}`));
process.on('SIGTERM', () => {
  io.close();
  server.close(() => process.exit(0));
});
