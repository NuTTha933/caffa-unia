const { audit } = require('../services/auditService');

const TRACKED = /^\/(app|admin|api)(\/|$)/;
const SKIP = /^\/(app|api)\/files\//;

function activityLog(req, res, next) {
  if (req.method !== 'GET') return next();
  const url = req.originalUrl.split('?')[0];
  if (!TRACKED.test(url) || SKIP.test(url)) return next();

  res.on('finish', () => {
    if (!req.user || res.statusCode >= 300) return;
    const isApi = url.startsWith('/api');
    const query = Object.keys(req.query || {}).length ? { query: req.query } : undefined;
    audit(req, {
      category: 'navigation',
      action: isApi ? 'api.read' : 'page.view',
      details: query,
    });
  });
  next();
}

module.exports = { activityLog };
