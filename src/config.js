// ค่าตั้งค่าทั้งหมดอ่านจากไฟล์ .env (ดูตัวอย่างใน .env.example) — ไม่ใส่รหัสผ่านจริงไว้ในโค้ด
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');
const env = process.env.NODE_ENV || 'development';

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (env === 'production') throw new Error('ต้องตั้งค่า SESSION_SECRET ในไฟล์ .env');
  sessionSecret = crypto.randomBytes(32).toString('hex');
  if (env !== 'test') {
    console.warn('[config] ไม่ได้ตั้ง SESSION_SECRET — ใช้ค่าสุ่มชั่วคราว (ผู้ใช้จะถูกออกจากระบบเมื่อเริ่ม Server ใหม่)');
  }
}

module.exports = {
  env,
  isProd: env === 'production',
  port: int(process.env.PORT, 3000),
  timezone: 'Asia/Bangkok',
  root,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || 'kernel_coffee',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },

  session: {
    secret: sessionSecret,
    cookieName: 'kc.sid',
    maxAgeMs: int(process.env.SESSION_MAX_AGE_MIN, 120) * 60 * 1000,
    secureCookie: process.env.COOKIE_SECURE === 'true',
  },

  upload: {
    dir: path.resolve(root, process.env.UPLOAD_DIR || 'storage/uploads'),
    // กำหนดชนิดไฟล์และขนาดสูงสุดแยกตามประเภทไฟล์
    rules: {
      menu_image: {
        label: 'ภาพเมนู',
        maxBytes: int(process.env.MAX_IMAGE_MB, 2) * 1024 * 1024,
        types: ['image/jpeg', 'image/png', 'image/webp'],
      },
      payment_slip: {
        label: 'สลิปโอนเงิน',
        maxBytes: int(process.env.MAX_SLIP_MB, 3) * 1024 * 1024,
        types: ['image/jpeg', 'image/png', 'application/pdf'],
      },
    },
  },

  // ข้อมูลร้าน (ใช้แสดงในหน้าแนบสลิป) — บัญชีตัวอย่างสำหรับงานโครงงานเท่านั้น
  shop: {
    name: process.env.SHOP_NAME || 'Kernel Coffee',
    promptpay: process.env.SHOP_PROMPTPAY || '0-0000-00000-00-0 (บัญชีตัวอย่าง)',
  },

  loginLimit: {
    maxFailures: int(process.env.LOGIN_MAX_FAILURES, 8),
    windowMs: 10 * 60 * 1000,
  },
};
