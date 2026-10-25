// =====================================================================
//  สร้าง Express App — ลำดับ Middleware (สำคัญต่อความปลอดภัย)
//  1 helmet → 2 static → 3 body parser → 4 session → 5 loadUser → 6 csrf/flash
//  7 activityLog → 8 routes (requireAuth → adminAreaGate → verifyCsrf → authorize → handler)
//  9 404 → 10 errorHandler
// =====================================================================
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const db = require('./db');
const fmt = require('./utils/format');
const { loadUser, requireAuth } = require('./middleware/auth');
const { adminAreaGate } = require('./middleware/acl');
const { csrfToken, verifyCsrf, flash } = require('./middleware/security');
const { activityLog } = require('./middleware/activityLog');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/app');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const apiAdminRoutes = require('./routes/api/admin');

function createApp({ sessionStore } = {}) {
  const app = express();
  const root = config.root;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', process.env.TRUST_PROXY === 'true');
  app.disable('x-powered-by');
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  app.locals.fmt = fmt;
  app.locals.h = require('./utils/viewHelpers');
  app.locals.appName = config.shop.name;
  app.locals.shop = config.shop;
  app.locals.showDemoAccounts = !config.isProd;

  // 1) Security headers (CSP อนุญาตเฉพาะไฟล์จาก Server ตัวเอง)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: config.isProd,
  }));

  // 2) ไฟล์ static (ไม่รวม storage/uploads — ไฟล์อัปโหลดเปิดผ่าน Route ที่ตรวจสิทธิ์เท่านั้น)
  const vendor = { maxAge: '7d' };
  // ฟอนต์เสิร์ฟจาก Server เอง (ใช้งานได้แม้ไม่มีอินเทอร์เน็ต): Trirong (หัวเรื่อง) + IBM Plex Sans Thai (เนื้อหา) + IBM Plex Mono (รหัส)
  app.use('/vendor/fonts/trirong', express.static(path.join(root, 'node_modules/@fontsource/trirong'), vendor));
  app.use('/vendor/fonts/plex-thai', express.static(path.join(root, 'node_modules/@fontsource/ibm-plex-sans-thai'), vendor));
  app.use('/vendor/fonts/plex-mono', express.static(path.join(root, 'node_modules/@fontsource/ibm-plex-mono'), vendor));
  app.use(express.static(path.join(root, 'public'), { maxAge: config.isProd ? '1d' : 0 }));

  // 3) Body parser (จำกัดขนาด)
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));

  // 4) Session เก็บใน PostgreSQL (ออกจากระบบ = ลบ Session ฝั่ง Server ทันที)
  app.use(session({
    store: sessionStore || new PgSession({
      pool: db.pool,
      tableName: 'user_sessions',
      pruneSessionInterval: config.env === 'test' ? false : 15 * 60,
    }),
    name: config.session.cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.session.secureCookie,
      maxAge: config.session.maxAgeMs,
    },
  }));

  // 5) โหลดผู้ใช้ + สิทธิ์ล่าสุดจากฐานข้อมูล, 6) CSRF token + Flash, 7) Log การเข้าใช้หน้า
  app.use(loadUser);
  app.use(csrfToken);
  app.use(flash);
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.query = req.query;
    next();
  });
  app.use(activityLog);

  // 8) Routes — แยกส่วนผู้ใช้ทั่วไป / ส่วน Admin / API / API Admin ทาง Logical
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/', authRoutes);
  app.use('/app', requireAuth, verifyCsrf, appRoutes);
  app.use('/admin', requireAuth, adminAreaGate, verifyCsrf, adminRoutes);
  app.use('/api/admin', requireAuth, adminAreaGate, verifyCsrf, apiAdminRoutes);
  app.use('/api', requireAuth, verifyCsrf, apiRoutes);

  // 9) 404, 10) Error handler
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
