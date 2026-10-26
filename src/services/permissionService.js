const db = require('../db');
const { audit } = require('./auditService');
const { Validator } = require('../utils/validator');
const { notFound, validation } = require('../utils/httpError');

async function list() {
  return (await db.query(
    `SELECT p.*,
            COALESCE(json_agg(json_build_object('code', f.code, 'name', f.name) ORDER BY f.sort_order)
                     FILTER (WHERE f.id IS NOT NULL), '[]') AS functions,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.permission_id = p.id) AS role_count,
            (SELECT string_agg(r.name, ', ' ORDER BY r.id) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE rp.permission_id = p.id AND NOT r.is_admin) AS role_names
       FROM permissions p
       LEFT JOIN permission_functions pf ON pf.permission_id = p.id
       LEFT JOIN app_functions f ON f.id = pf.function_id
      GROUP BY p.id
      ORDER BY split_part(p.code, '.', 1), p.code`,
  )).rows;
}

async function get(id) {
  const p = (await db.query('SELECT * FROM permissions WHERE id=$1', [id])).rows[0];
  if (!p) throw notFound('ไม่พบ Permission');
  p.function_ids = (await db.query('SELECT function_id FROM permission_functions WHERE permission_id=$1', [id]))
    .rows.map((r) => r.function_id);
  return p;
}

async function functionOptions() {
  return (await db.query(
    `SELECT f.*,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.id IS NOT NULL), '{}') AS permission_codes
       FROM app_functions f
       LEFT JOIN permission_functions pf ON pf.function_id = f.id
       LEFT JOIN permissions p ON p.id = pf.permission_id
      GROUP BY f.id ORDER BY f.sort_order, f.code`,
  )).rows;
}

function validatePermission(input) {
  const v = new Validator(input);
  v.string('code', 'รหัส Permission', {
    min: 3, max: 100, lower: true, pattern: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    patternMessage: 'รูปแบบต้องเป็น ทรัพยากร.การกระทำ เช่น report.view (a-z, 0-9, _)',
  })
    .string('name', 'ชื่อ Permission', { max: 150 })
    .string('description', 'คำอธิบาย', { required: false, max: 500 })
    .intList('function_ids');
  return v.done();
}

async function assertFunctions(client, ids) {
  if (!ids.length) return [];
  const rows = (await client.query('SELECT id, code FROM app_functions WHERE id = ANY($1)', [ids])).rows;
  if (rows.length !== ids.length) throw validation({ function_ids: 'มีฟังก์ชันที่เลือกไม่ถูกต้อง' });
  return rows.map((r) => r.code);
}

async function create(req, input) {
  const data = validatePermission(input);
  let result;
  try {
    result = await db.withTransaction(async (client) => {
      const fnCodes = await assertFunctions(client, data.function_ids);
      const p = (await client.query(
        'INSERT INTO permissions (code, name, description) VALUES ($1,$2,$3) RETURNING *',
        [data.code, data.name, data.description],
      )).rows[0];
      for (const fid of data.function_ids) {
        await client.query('INSERT INTO permission_functions (permission_id, function_id) VALUES ($1,$2)', [p.id, fid]);
      }
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         SELECT id, $1, $2 FROM roles WHERE is_admin ON CONFLICT DO NOTHING`,
        [p.id, req.user.id],
      );
      return { p, fnCodes };
    });
  } catch (err) {
    if (err.code === '23505') throw validation({ code: 'รหัส Permission นี้มีอยู่แล้ว' });
    throw err;
  }
  await audit(req, {
    category: 'admin', action: 'permission.create', resourceType: 'permission', resourceId: result.p.id,
    details: { code: result.p.code, name: result.p.name, functions: result.fnCodes },
  });
  return result.p;
}

async function update(req, id, input) {
  const data = validatePermission(input);
  let result;
  try {
    result = await db.withTransaction(async (client) => {
      const before = (await client.query('SELECT * FROM permissions WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!before) throw notFound('ไม่พบ Permission');
      const beforeFns = (await client.query(
        `SELECT f.code FROM permission_functions pf JOIN app_functions f ON f.id=pf.function_id WHERE pf.permission_id=$1`,
        [id],
      )).rows.map((r) => r.code);
      const fnCodes = await assertFunctions(client, data.function_ids);
      await client.query('UPDATE permissions SET code=$1, name=$2, description=$3 WHERE id=$4',
        [data.code, data.name, data.description, id]);
      await client.query('DELETE FROM permission_functions WHERE permission_id=$1', [id]);
      for (const fid of data.function_ids) {
        await client.query('INSERT INTO permission_functions (permission_id, function_id) VALUES ($1,$2)', [id, fid]);
      }
      return { before, beforeFns, fnCodes };
    });
  } catch (err) {
    if (err.code === '23505') throw validation({ code: 'รหัส Permission นี้มีอยู่แล้ว' });
    throw err;
  }
  const added = result.fnCodes.filter((c) => !result.beforeFns.includes(c));
  const removed = result.beforeFns.filter((c) => !result.fnCodes.includes(c));
  await audit(req, {
    category: 'admin', action: 'permission.update', resourceType: 'permission', resourceId: id,
    details: {
      code: [result.before.code, data.code], name: [result.before.name, data.name],
      functions_added: added, functions_removed: removed,
    },
  });
}

async function remove(req, id) {
  const result = await db.withTransaction(async (client) => {
    const p = (await client.query('SELECT * FROM permissions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!p) throw notFound('ไม่พบ Permission');
    const roles = (await client.query(
      'SELECT r.code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE rp.permission_id=$1', [id],
    )).rows.map((r) => r.code);
    await client.query('DELETE FROM permissions WHERE id=$1', [id]);
    return { p, roles };
  });
  await audit(req, {
    category: 'admin', action: 'permission.delete', resourceType: 'permission', resourceId: id,
    details: { code: result.p.code, revoked_from_roles: result.roles },
  });
}

module.exports = { list, get, functionOptions, create, update, remove };
