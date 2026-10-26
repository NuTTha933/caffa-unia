const multer = require('multer');
const config = require('../config');
const { audit } = require('../services/auditService');
const { describeRule } = require('../services/fileService');
const { badRequest } = require('../utils/httpError');

function uploadSingle(kind, { field = 'file', resourceType, redirect } = {}) {
  const rule = config.upload.rules[kind];
  const receive = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: rule.maxBytes, files: 1, fields: 10 },
    defParamCharset: 'utf8',
  }).single(field);

  return function uploadMiddleware(req, res, next) {
    receive(req, res, async (err) => {
      if (!err) return next();
      if (!(err instanceof multer.MulterError)) return next(err);

      let message;
      if (err.code === 'LIMIT_FILE_SIZE') message = `ไฟล์มีขนาดเกินกำหนด — ${rule.label}รับเฉพาะ ${describeRule(kind)}`;
      else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') message = 'อัปโหลดได้ครั้งละ 1 ไฟล์';
      else message = `อัปโหลดไฟล์ไม่สำเร็จ (${err.code})`;

      await audit(req, {
        category: 'file', action: 'file.upload_rejected', result: 'failure',
        resourceType, resourceId: req.params.id,
        details: { kind, reason: err.code === 'LIMIT_FILE_SIZE' ? 'too_large' : err.code, limit_bytes: rule.maxBytes },
      });

      if (redirect && !req.originalUrl.startsWith('/api/')) {
        req.flash('danger', message);
        return res.redirect(redirect(req));
      }
      return next(badRequest(message));
    });
  };
}

module.exports = { uploadSingle };
