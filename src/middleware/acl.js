const { ADMIN_AREA_FUNCTIONS, assertKnown } = require('../acl/functions');
const { forbidden } = require('../utils/httpError');
const { requireAuth } = require('./auth');

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

const adminAreaGate = authorize(...ADMIN_AREA_FUNCTIONS);

module.exports = { authorize, adminAreaGate };
