// =====================================================================
//  Middleware : จัดการข้อผิดพลาดกลาง + 404
//  - 403 ทุกกรณี (ไม่มีสิทธิ์/ไม่ใช่เจ้าของ/ไฟล์ต้องห้าม) จะถูกบันทึก Log ที่นี่
//  - API ตอบ JSON, หน้าเว็บแสดงหน้า Error ภาษาไทย
// =====================================================================
const { audit } = require('../services/auditService');
const { notFound } = require('../utils/httpError');
const { isApi } = require('./auth');

const TITLES = {
  400: 'ข้อมูลไม่ถูกต้อง',
  401: 'กรุณาเข้าสู่ระบบ',
  403: 'ไม่มีสิทธิ์เข้าถึง',
  404: 'ไม่พบหน้าที่ต้องการ',
  409: 'ไม่สามารถดำเนินการได้',
  413: 'ข้อมูลใหญ่เกินไป',
  422: 'ข้อมูลไม่ถูกต้อง',
  500: 'เกิดข้อผิดพลาดในระบบ',
};

const CODES = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'payload_too_large', 422: 'validation_error' };

function notFoundHandler(req, res, next) {
  next(notFound('ไม่พบหน้าที่ต้องการ'));
}

// eslint-disable-next-line no-unused-vars
async function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  if (err.type === 'entity.too.large') status = 413;
  if (err.type === 'entity.parse.failed') status = 400;
  const expose = err.expose || status < 500;

  if (status === 403) {
    await audit(req, {
      category: err.fileAccess ? 'file' : 'access',
      action: err.fileAccess ? 'file.access_denied' : 'access_denied',
      result: 'denied',
      resourceType: err.resourceType,
      resourceId: err.resourceId,
      details: { reason: err.reason || 'forbidden', required_functions: err.required, message: err.message },
    });
  }
  if (status >= 500) console.error('[error]', err);

  const message = expose ? err.message : 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง';
  if (res.headersSent) return undefined;

  if (isApi(req) || (req.get('accept') || '').includes('application/json')) {
    return res.status(status).json({
      error: CODES[status] || 'server_error',
      message,
      ...(err.errors ? { errors: err.errors } : {}),
      ...(status === 403 && err.required ? { required_functions: err.required } : {}),
    });
  }

  return res.status(status).render('errors/error', {
    layout: req.user ? 'layouts/main' : 'layouts/auth',
    title: TITLES[status] || 'เกิดข้อผิดพลาด',
    status,
    message,
    required: err.required,
  });
}

module.exports = { notFoundHandler, errorHandler };
