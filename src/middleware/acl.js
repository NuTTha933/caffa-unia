// =====================================================================
//  Middleware : Authorization (ACL)
//  authorize('menu.create') → ผ่านเมื่อ Role ของผู้ใช้มี Permission
//  ที่ "เชื่อมกับฟังก์ชันนี้" อยู่ในฐานข้อมูล (หรือเป็น Role Admin)
//  ไม่ผ่าน → ส่ง Error 403 ไปที่ errorHandler (บันทึก Log การเข้าถึงที่ถูกปฏิเสธ)
// =====================================================================
const { ADMIN_AREA_FUNCTIONS, assertKnown } = require('../acl/functions');
const { forbidden } = require('../utils/httpError');
const { requireAuth } = require('./auth');

/**
 * @param  {...string} functionCodes  ผ่านถ้ามีสิทธิ์ "อย่างน้อยหนึ่ง" ฟังก์ชัน
 */
function authorize(...functionCodes) {
  functionCodes.forEach(assertKnown);
  return function authorizeMiddleware(req, res, next) {
    if (!req.user) return requireAuth(req, res, next);
    if (req.user.isAdmin || functionCodes.some((code) => req.user.functions.has(code))) {
      return next();
    }
    return next(forbidden('คุณไม่มีสิทธิ์ใช้งานฟังก์ชันนี้', {
      reason: 'missing_permission',
      required: functionCodes,
    }));
  };
}

// ประตูของ "ส่วน Admin" (/admin/*, /api/admin/*) — ต้องมีสิทธิ์งานผู้ดูแลระบบอย่างน้อย 1 อย่าง
const adminAreaGate = authorize(...ADMIN_AREA_FUNCTIONS);

module.exports = { authorize, adminAreaGate };
