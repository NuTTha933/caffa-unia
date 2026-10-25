// การเชื่อมต่อ PostgreSQL ด้วย Connection Pool
const { Pool, types } = require('pg');
const config = require('./config');

// คอลัมน์ DATE ให้คืนเป็นข้อความ 'YYYY-MM-DD' (กันปัญหา timezone เลื่อนวัน)
types.setTypeParser(1082, (value) => value);
// COUNT(*) เป็น bigint — แปลงเป็น number (ข้อมูลในระบบไม่ใหญ่เกิน Number)
types.setTypeParser(20, (value) => parseInt(value, 10));
// NUMERIC (ราคา/ยอดเงิน) — แปลงเป็น number (ทศนิยม 2 ตำแหน่ง อยู่ในช่วงที่ Number แทนได้แม่นยำ)
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

// ทำงานหลายคำสั่งใน Transaction เดียว — ถ้าผิดพลาดจะ ROLLBACK ทั้งหมด
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
