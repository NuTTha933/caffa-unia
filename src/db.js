const { Pool, types } = require('pg');
const config = require('./config');

types.setTypeParser(1082, (value) => value);
types.setTypeParser(20, (value) => parseInt(value, 10));
types.setTypeParser(1700, (value) => parseFloat(value));

const pool = new Pool({
  ...config.db,
  max: 10,
  options: `-c timezone=${config.timezone}`,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
