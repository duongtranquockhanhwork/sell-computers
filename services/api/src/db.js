const { Pool, types } = require('pg');
const config = require('./config');

// BIGINT (COUNT, SUM over integers) -> JS number. Our amounts stay far below 2^53.
types.setTypeParser(20, (v) => Number(v));
// NUMERIC -> JS number (averages, ratings).
types.setTypeParser(1700, (v) => Number(v));

// Reports and date filters are computed in the shop's local time zone.
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  options: `-c timezone=${process.env.TZ || 'Asia/Ho_Chi_Minh'}`,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

function query(text, params) {
  return pool.query(text, params);
}

// Runs fn inside a transaction; rolls back on any thrown error.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function waitForDatabase(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`[db] waiting for PostgreSQL (${i}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('PostgreSQL is not reachable');
}

module.exports = { pool, query, tx, waitForDatabase };
