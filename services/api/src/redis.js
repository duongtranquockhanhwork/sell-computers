// Redis is shared by all API replicas: pub/sub towards the realtime service and
// fixed-window rate limiting. No per-instance state lives in the API process.
const Redis = require('ioredis');
const config = require('./config');
const { HttpError } = require('./lib/http');

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
redis.on('error', (e) => console.error('[redis]', e.message));

// Channel consumed by the realtime service and broadcast to Socket.IO rooms.
const REALTIME_CHANNEL = 'techhaven:realtime';

function broadcast(room, event, payload) {
  return redis
    .publish(REALTIME_CHANNEL, JSON.stringify({ room, event, payload }))
    .catch((e) => console.error('[redis] publish failed', e.message));
}

// limit requests per key within windowSeconds; fails open if Redis is down.
function rateLimit({ name, limit, windowSeconds, key = (req) => req.ip }) {
  return async (req, _res, next) => {
    try {
      const k = `rl:${name}:${key(req)}`;
      const count = await redis.incr(k);
      if (count === 1) await redis.expire(k, windowSeconds);
      if (count > limit) {
        return next(new HttpError(429, 'Too many attempts. Please wait a moment and try again.'));
      }
    } catch (err) {
      console.error('[redis] rate limit unavailable', err.message);
    }
    next();
  };
}

module.exports = { redis, broadcast, rateLimit, REALTIME_CHANNEL };
