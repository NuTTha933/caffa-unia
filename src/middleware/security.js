// =====================================================================
//  Middleware : CSRF token, Flash message, Login rate limit
// =====================================================================
const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../utils/httpError');

// ---------------- CSRF (Synchronizer token เก็บใน Session) ----------------
function csrfToken(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  if (sent) {
    if (safeEqual(sent, req.session.csrfToken)) return next();
    return next(new HttpError(403, 'แบบฟอร์มหมดอายุ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง', { reason: 'csrf_invalid' }));
  }
  // API ที่ส่ง JSON: Browser ข้ามโดเมนส่ง application/json พร้อม cookie ไม่ได้ (ต้องผ่าน CORS preflight)
  const isJson = /^application\/json\b/i.test(req.get('content-type') || '');
  if (req.originalUrl.startsWith('/api/') && isJson) return next();
  return next(new HttpError(403, 'คำขอไม่มี CSRF token — กรุณาส่งจากแบบฟอร์มในระบบ', { reason: 'csrf_missing' }));
}

// ---------------- Flash message ----------------
function flash(req, res, next) {
  req.flash = (type, message) => {
    if (!req.session.flash) req.session.flash = [];
    req.session.flash.push({ type, message });
  };
  res.locals.flash = req.session.flash || [];
  if (req.session.flash) delete req.session.flash;
  next();
}

// ---------------- จำกัดการเดารหัสผ่าน ----------------
const failures = new Map();

function limiterKey(req, username) {
  return `${req.ip}|${String(username || '').toLowerCase()}`;
}

const loginLimiter = {
  isBlocked(req, username) {
    const k = limiterKey(req, username);
    const a = failures.get(k);
    if (!a) return false;
    if (Date.now() - a.first > config.loginLimit.windowMs) {
      failures.delete(k);
      return false;
    }
    return a.count >= config.loginLimit.maxFailures;
  },
  fail(req, username) {
    const k = limiterKey(req, username);
    const a = failures.get(k);
    if (!a || Date.now() - a.first > config.loginLimit.windowMs) failures.set(k, { count: 1, first: Date.now() });
    else a.count += 1;
  },
  reset(req, username) {
    failures.delete(limiterKey(req, username));
  },
};

module.exports = { csrfToken, verifyCsrf, flash, loginLimiter };
