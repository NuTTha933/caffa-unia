// สร้างฐานข้อมูล (ถ้ายังไม่มี) + รัน database/schema.sql และ database/seed.sql
// ใช้: npm run db:setup
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

async function ensureDatabase() {
  const admin = new Client({ ...config.db, database: 'postgres' });
  try {
    await admin.connect();
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
    if (!exists.rowCount) {
      if (!/^[A-Za-z0-9_]+$/.test(config.db.database)) throw new Error('ชื่อฐานข้อมูลใช้ได้เฉพาะ A-Z, 0-9 และ _');
      await admin.query(`CREATE DATABASE "${config.db.database}" ENCODING 'UTF8'`);
      console.log(`✓ สร้างฐานข้อมูล ${config.db.database}`);
    }
  } catch (err) {
    console.warn(`(ข้ามการสร้างฐานข้อมูลอัตโนมัติ: ${err.message})`);
  } finally {
    await admin.end().catch(() => {});
  }
}

function cleanUploads() {
  const dir = config.upload.dir;
  if (!fs.existsSync(dir)) return fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (/^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(name)) fs.unlinkSync(path.join(dir, name));
  }
}

// คัดลอกไฟล์ตัวอย่าง (สลิป/ภาพเมนู) ให้ตรงกับแถวในตาราง files ที่ seed.sql สร้างไว้
async function copySeedFiles(client) {
  const seedDir = path.join(__dirname, '..', 'database', 'seed-files');
  const rows = (await client.query('SELECT id, kind, original_name, stored_name FROM files')).rows;
  for (const f of rows) {
    const src = f.kind === 'payment_slip'
      ? path.join(seedDir, 'slip-sample.png')
      : path.join(seedDir, 'menu', path.basename(f.original_name));
    const dest = path.join(config.upload.dir, path.basename(f.stored_name));
    fs.copyFileSync(src, dest);
    await client.query('UPDATE files SET size_bytes = $1 WHERE id = $2', [fs.statSync(dest).size, f.id]);
  }
  return rows.length;
}

async function main() {
  await ensureDatabase();
  const client = new Client(config.db);
  await client.connect();
  await client.query('SET client_min_messages TO WARNING');
  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', file), 'utf8');
    await client.query(sql);
    console.log(`✓ รัน database/${file}`);
  }
  cleanUploads();
  const n = await copySeedFiles(client);
  await client.end();
  console.log(`✓ ล้างไฟล์อัปโหลดเดิมและคัดลอกไฟล์ตัวอย่าง ${n} ไฟล์แล้ว — พร้อมใช้งาน: npm start`);
}

main().catch((err) => {
  console.error('✗ ติดตั้งฐานข้อมูลไม่สำเร็จ:', err.message);
  process.exit(1);
});
