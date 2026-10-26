const { notFound } = require('../utils/httpError');

function idParam(req, name = 'id') {
  const s = String(req.params[name] || '');
  if (!/^\d{1,9}$/.test(s) || Number(s) < 1) throw notFound();
  return Number(s);
}

function pageParam(req) {
  const n = parseInt(req.query.page, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 1;
}

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

function safeNext(value) {
  const s = String(value || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || s.length > 300) return null;
  if (s.startsWith('/login') || s.startsWith('/logout')) return null;
  return s;
}

module.exports = { idParam, pageParam, withFlashBack, safeNext };
