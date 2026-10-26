const db = require('../db');
const { audit } = require('./auditService');
const { Validator } = require('../utils/validator');
const { notFound, conflict, validation } = require('../utils/httpError');

async function list() {
  return (await db.query(
    `SELECT r.*,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
       FROM roles r ORDER BY r.is_admin DESC, r.id`,
  )).rows;
}

async function get(id) {
  const role = (await db.query(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r WHERE r.id = $1`,
    [id],
  )).rows[0];
  if (!role) throw notFound('ไม่พบบทบาท');
  role.permissions = (await db.query(
    `SELECT p.code, p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 ORDER BY p.code`,
    [id],
  )).rows;
  role.users = (await db.query(
    'SELECT id, username, full_name, is_active FROM users WHERE role_id = $1 ORDER BY username',
    [id],
  )).rows;
  return role;
}

function validateRole(input, { isNew }) {
  const v = new Validator(input);
  if (isNew) {
    v.string('code', 'รหัสบทบาท', {
      min: 2, max: 50, lower: true, pattern: /^[a-z][a-z0-9_]+$/,
      patternMessage: 'รหัสบทบาทใช้ a-z, 0-9 และ _ (ขึ้นต้นด้วยตัวอักษร)',
    });
    v.int('copy_from', 'คัดลอกสิทธิ์จาก', { required: false, min: 1 });
  }
  v.string('name', 'ชื่อบทบาท', { max: 100 })
    .string('description', 'คำอธิบาย', { required: false, max: 500 });
  return v.done();
}

async function create(req, input) {
  const data = validateRole(input, { isNew: true });
  let role;
  try {
    role = await db.withTransaction(async (client) => {
      const row = (await client.query(
        'INSERT INTO roles (code, name, description) VALUES ($1,$2,$3) RETURNING *',
        [data.code, data.name, data.description],
      )).rows[0];
      if (data.copy_from) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_by)
           SELECT $1, permission_id, $3 FROM role_permissions WHERE role_id = $2`,
          [row.id, data.copy_from, req.user.id],
        );
      }
      return row;
    });
  } catch (err) {
    if (err.code === '23505') throw validation({ code: 'รหัสบทบาทนี้มีอยู่แล้ว' });
    throw err;
  }
  await audit(req, {
    category: 'admin', action: 'role.create', resourceType: 'role', resourceId: role.id,
    details: { code: role.code, name: role.name, copied_from_role_id: data.copy_from || null },
  });
  return role;
}

async function update(req, id, input) {
  const data = validateRole(input, { isNew: false });
  const before = (await db.query('SELECT * FROM roles WHERE id=$1', [id])).rows[0];
  if (!before) throw notFound('ไม่พบบทบาท');
  await db.query('UPDATE roles SET name=$1, description=$2 WHERE id=$3', [data.name, data.description, id]);
  await audit(req, {
    category: 'admin', action: 'role.update', resourceType: 'role', resourceId: id,
    details: { code: before.code, name: [before.name, data.name] },
  });
}

async function remove(req, id) {
  const role = await db.withTransaction(async (client) => {
    const row = (await client.query('SELECT * FROM roles WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw notFound('ไม่พบบทบาท');
    if (row.is_system || row.is_admin) throw conflict(`บทบาท "${row.name}" เป็นบทบาทหลักของระบบ ลบไม่ได้`);
    const n = (await client.query('SELECT COUNT(*) AS n FROM users WHERE role_id=$1', [id])).rows[0].n;
    if (n > 0) throw conflict(`ลบไม่ได้: ยังมีผู้ใช้ในบทบาท "${row.name}" อยู่ ${n} คน — ย้ายผู้ใช้ไปบทบาทอื่นก่อน`);
    await client.query('DELETE FROM roles WHERE id=$1', [id]);
    return row;
  });
  await audit(req, {
    category: 'admin', action: 'role.delete', resourceType: 'role', resourceId: id,
    details: { code: role.code, name: role.name },
  });
}

async function options() {
  return (await db.query('SELECT id, code, name, is_admin FROM roles ORDER BY is_admin DESC, id')).rows;
}

module.exports = { list, get, create, update, remove, options };
