// ตัวช่วยที่ใช้ร่วมกันใน Route
const { notFound } = require('../utils/httpError');

// อ่าน :id ที่เป็นจำนวนเต็มบวก (ไม่ใช่ตัวเลข → 404)
function idParam(req, name = 'id') {
  const s = String(req.params[name] || '');
  if (!/^\d{1,9}$/.test(s) || Number(s) < 1) throw notFound();
  return Number(s);
}

function pageParam(req) {
  const n = parseInt(req.query.page, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 1;
}

/**
 * ห่อ handler ของปุ่มดำเนินการ: ถ้าเกิดข้อผิดพลาดทางธุรกิจ (400/409/422)
 * ให้แสดงข้อความแบบ flash แล้วกลับไปหน้าเดิม — ส่วน 403/404/500 ส่งต่อ errorHandler
 */
function withFlashBack(handler, back) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err.expose && [400, 409, 422].includes(err.status)) {
        const msg = err.errors ? Object.values(err.errors).join(' / ') : err.message;
        req.flash('danger', msg);
        return res.redirect(typeof back === 'function' ? back(req) : back);
      }
      throw err;
    }
  };
}

// เส้นทางสำหรับ redirect หลังเข้าสู่ระบบ (กัน open redirect)
function safeNext(value) {
  const s = String(value || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || s.length > 300) return null;
  if (s.startsWith('/login') || s.startsWith('/logout')) return null;
  return s;
}

module.exports = { idParam, pageParam, withFlashBack, safeNext };
