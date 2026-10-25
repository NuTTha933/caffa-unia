// =====================================================================
//  Middleware : Authentication
//  - loadUser    : อ่านผู้ใช้จาก Session แล้วโหลด Role/สิทธิ์ล่าสุดจากฐานข้อมูลทุก Request
//  - requireAuth : ป้องกันหน้า/API ที่ต้องเข้าสู่ระบบ
// =====================================================================
const { loadAccess, can } = require('../services/aclService');
const { audit } = require('../services/auditService');

const isApi = (req) => req.originalUrl.startsWith('/api/') || req.originalUrl === '/api';

async function loadUser(req, res, next) {
  req.user = null;
  if (req.session && req.session.userId) {
    const user = await loadAccess(req.session.userId);
    if (user && user.isActive) {
      req.user = user;
    } else {
      // บัญชีถูกลบหรือถูกปิดใช้งาน → ยกเลิก Session ทันที
      await audit(req, {
        category: 'auth', action: 'session_revoked', result: 'denied', user: null,
        username: user ? user.username : null,
        details: { reason: user ? 'account_disabled' : 'account_deleted' },
      });
      await new Promise((resolve) => req.session.regenerate(() => resolve()));
    }
  }
  req.can = (code) => can(req.user, code);
  res.locals.currentUser = req.user;
  res.locals.can = req.can;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  audit(req, { category: 'access', action: 'auth_required', result: 'denied', details: { reason: 'not_logged_in' } });
  if (isApi(req)) {
    return res.status(401).json({ error: 'unauthenticated', message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
  }
  const nextUrl = req.method === 'GET' ? req.originalUrl : '/app';
  return res.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
}

function redirectIfLoggedIn(req, res, next) {
  if (req.user) return res.redirect('/app');
  next();
}

module.exports = { loadUser, requireAuth, redirectIfLoggedIn, isApi };
