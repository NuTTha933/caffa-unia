const db = require('../db');
const { LOG_CATEGORIES } = require('../utils/format');

const SENSITIVE_KEY = /pass(word)?|pwd|token|secret|session|sid|cookie|csrf|authorization|hash/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

function clip(s, n) {
  if (s === undefined || s === null) return null;
  const str = String(s);
  return str.length > n ? str.slice(0, n) : str;
}

async function audit(req, e) {
  try {
    const user = e.user !== undefined ? e.user : req && req.user;
    const path = req ? (req.originalUrl || req.url || '').split('?')[0] : null;
    await db.query(
      `INSERT INTO audit_logs
        (user_id, username, role_code, category, action, resource_type, resource_id,
         result, method, path, ip, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        user ? user.id : null,
        clip(e.username || (user && user.username) || null, 100),
        clip(user ? user.roleCode : null, 50),
        e.category,
        clip(e.action, 60),
        clip(e.resourceType || null, 50),
        e.resourceId === undefined || e.resourceId === null ? null : clip(String(e.resourceId), 64),
        e.result || 'success',
        req ? clip(req.method, 10) : null,
        clip(path, 255),
        req ? clip(req.ip, 64) : null,
        req ? clip(req.get && req.get('user-agent'), 255) : null,
        e.details ? JSON.stringify(sanitize(e.details)) : null,
      ],
    );
  } catch (err) {
    console.error('[audit] บันทึก Log ไม่สำเร็จ:', err.message);
  }
}

const BUSINESS_CATEGORIES = ['order', 'menu', 'file'];

function buildFilter(filters, allowedCategories) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (allowedCategories) add('l.category = ANY(?)', allowedCategories);
  if (filters.from) add(`l.created_at >= (?::date)::timestamptz`, filters.from);
  if (filters.to) add(`l.created_at < ((?::date) + 1)::timestamptz`, filters.to);
  if (filters.userId) add('l.user_id = ?', filters.userId);
  if (filters.username) add('l.username ILIKE ?', `%${filters.username}%`);
  if (filters.category) add('l.category = ?', filters.category);
  if (filters.action) add('l.action ILIKE ?', `%${filters.action}%`);
  if (filters.result) add('l.result = ?', filters.result);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(l.path ILIKE ${p} OR l.resource_id ILIKE ${p} OR l.resource_type ILIKE ${p} OR l.details::text ILIKE ${p})`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function search(filters, { allowedCategories, page = 1, pageSize = 50 } = {}) {
  const { whereSql, params } = buildFilter(filters, allowedCategories);
  const total = (await db.query(`SELECT COUNT(*) AS n FROM audit_logs l ${whereSql}`, params)).rows[0].n;
  const offset = (page - 1) * pageSize;
  const rows = (await db.query(
    `SELECT l.* FROM audit_logs l ${whereSql}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`,
    params,
  )).rows;
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function exportRows(filters, { allowedCategories, limit = 10000 } = {}) {
  const { whereSql, params } = buildFilter(filters, allowedCategories);
  return (await db.query(
    `SELECT l.* FROM audit_logs l ${whereSql} ORDER BY l.created_at DESC, l.id DESC LIMIT ${Number(limit)}`,
    params,
  )).rows;
}

async function distinctActions(allowedCategories) {
  const r = allowedCategories
    ? await db.query('SELECT DISTINCT action FROM audit_logs WHERE category = ANY($1) ORDER BY action', [allowedCategories])
    : await db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  return r.rows.map((x) => x.action);
}

function categoriesFor(canViewAll) {
  return canViewAll ? Object.keys(LOG_CATEGORIES) : BUSINESS_CATEGORIES;
}

module.exports = { audit, sanitize, search, exportRows, distinctActions, categoriesFor, BUSINESS_CATEGORIES };
