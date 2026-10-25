// =====================================================================
//  Authentication : เข้าสู่ระบบ / ออกจากระบบ (Session-based)
// =====================================================================
const express = require('express');
const config = require('../config');
const userService = require('../services/userService');
const { loadAccess } = require('../services/aclService');
const { audit } = require('../services/auditService');
const { verifyCsrf, loginLimiter } = require('../middleware/security');
const { requireAuth, redirectIfLoggedIn } = require('../middleware/auth');
const { safeNext } = require('./helpers');

const router = express.Router();

router.get('/', (req, res) => res.redirect(req.user ? '/app' : '/login'));

function renderLogin(res, status, { username = '', error = null, next = null, notice = null } = {}) {
  return res.status(status).render('auth/login', {
    layout: 'layouts/auth', title: 'เข้าสู่ระบบ', values: { username }, error, next, notice,
  });
}

router.get('/login', redirectIfLoggedIn, (req, res) => {
  let notice = null;
  if (req.query.loggedOut) notice = 'ออกจากระบบเรียบร้อยแล้ว';
  renderLogin(res, 200, { next: safeNext(req.query.next), notice });
});

router.post('/login', redirectIfLoggedIn, verifyCsrf, async (req, res) => {
  const username = String(req.body.username || '').trim().slice(0, 50);
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);

  if (!username || !password) {
    return renderLogin(res, 422, { username, next, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }
  if (loginLimiter.isBlocked(req, username)) {
    await audit(req, { category: 'auth', action: 'login_blocked', result: 'denied', username, details: { reason: 'too_many_failures' } });
    return renderLogin(res, 429, { username, next, error: 'เข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 10 นาทีแล้วลองใหม่' });
  }

  const result = await userService.authenticate(username, password);
  if (!result.user) {
    loginLimiter.fail(req, username);
    // บันทึกชื่อบัญชีที่พยายามเข้าสู่ระบบ แต่ไม่บันทึกรหัสผ่าน
    await audit(req, {
      category: 'auth', action: 'login_failed', result: 'failure', user: null, username,
      resourceType: result.userId ? 'user' : null, resourceId: result.userId,
      details: { reason: result.reason },
    });
    const error = result.reason === 'inactive'
      ? 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
      : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
    return renderLogin(res, 401, { username, next, error });
  }

  loginLimiter.reset(req, username);
  // ป้องกัน Session Fixation : สร้าง Session ID ใหม่ทุกครั้งที่เข้าสู่ระบบ
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = result.user.id;
  req.session.loginAt = new Date().toISOString();
  await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

  req.user = await loadAccess(result.user.id);
  await audit(req, { category: 'auth', action: 'login_success', resourceType: 'user', resourceId: result.user.id });
  return res.redirect(next || '/app');
});

router.post('/logout', requireAuth, verifyCsrf, async (req, res) => {
  await audit(req, { category: 'auth', action: 'logout', resourceType: 'user', resourceId: req.user.id });
  // ลบ Session ออกจากฐานข้อมูล → cookie เดิมใช้ไม่ได้อีก
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie(config.session.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.session.secureCookie });
  res.redirect('/login?loggedOut=1');
});

module.exports = router;
