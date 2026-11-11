// Central configuration. Every value comes from the environment so the same
// image runs unchanged in development, Docker Compose and CI.
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',
  instanceId: env.HOSTNAME || 'api-local',

  databaseUrl: env.DATABASE_URL || 'postgres://techhaven:techhaven@localhost:5432/techhaven',
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  amqpUrl: env.AMQP_URL || 'amqp://techhaven:techhaven@localhost:5672',
  searchUrl: env.SEARCH_URL || 'http://localhost:4100',

  jwtSecret: env.JWT_SECRET || 'techhaven-dev-secret-change-me',
  jwtTtlSeconds: 60 * 60 * 24 * 7,
  cookieSecure: env.COOKIE_SECURE === 'true',

  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),

  adminEmail: env.ADMIN_EMAIL || 'admin@techhaven.local',
  adminPassword: env.ADMIN_PASSWORD || 'Admin@123',
  seedDemoData: env.SEED_DEMO_DATA !== 'false',

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
};

config.google.enabled = Boolean(config.google.clientId && config.google.clientSecret);
config.google.redirectUri = `${config.publicUrl}/api/auth/google/callback`;

if (config.nodeEnv === 'production' && config.jwtSecret === 'techhaven-dev-secret-change-me') {
  // Refuse to run a production deployment with the default signing key.
  console.error('[config] JWT_SECRET must be set to a non-default value in production');
  process.exit(1);
}

module.exports = config;
