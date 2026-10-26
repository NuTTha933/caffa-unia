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
  if (process.env.DB_AUTO_SETUP === 'true') {
    const { ensureSchema, restoreSeedFiles } = require('./bootstrap');
    if (await ensureSchema(db)) console.log('[setup] สร้างตารางและข้อมูลตัวอย่างในฐานข้อมูลแล้ว');
    const restored = await restoreSeedFiles(db);
    if (restored) console.log(`[setup] คัดลอกไฟล์ตัวอย่าง ${restored} ไฟล์ไปที่โฟลเดอร์อัปโหลดแล้ว`);
  }
  await syncFunctions(db);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`${config.shop.name} — ระบบจัดการร้านกาแฟ พร้อมใช้งานที่ http://localhost:${config.port}`);
  });
}

main();
