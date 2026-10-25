// จุดเริ่มต้น Server
const config = require('./config');
const db = require('./db');
const { syncFunctions } = require('./acl/functions');
const { createApp } = require('./app');

async function main() {
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error('เชื่อมต่อ PostgreSQL ไม่ได้ — ตรวจค่า DB_* ในไฟล์ .env และรัน npm run db:setup ก่อน');
    console.error(err.message);
    process.exit(1);
  }
  await syncFunctions(db); // ลงทะเบียนฟังก์ชันที่ระบบรองรับ (จาก src/acl/functions.js)

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`${config.shop.name} — ระบบจัดการร้านกาแฟ พร้อมใช้งานที่ http://localhost:${config.port}`);
  });
}

main();
