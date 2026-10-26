const bcrypt = require('bcryptjs');
const db = require('../db');
const { audit } = require('./auditService');
const { Validator, checkPasswordPolicy } = require('../utils/validator');
const { notFound, conflict, forbidden, validation } = require('../utils/httpError');

const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-0000', BCRYPT_COST);

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function authenticate(username, password) {
  const row = (await db.query(
    'SELECT id, username, password_hash, is_active FROM users WHERE lower(username) = lower($1)',
    [username],
  )).rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row) return { reason: 'unknown_user' };
  if (!ok) return { reason: 'wrong_password', userId: row.id };
  if (!row.is_active) return { reason: 'inactive', userId: row.id };
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [row.id]);
  return { user: { id: row.id, username: row.username } };
}

async function ensureAdminRemains(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('caffa_unia.admin_guard'))");
  const n = (await client.query(
    `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.is_admin AND u.is_active`,
  )).rows[0].n;
  if (n < 1) {
    throw conflict('ไม่สามารถดำเนินการได้: ระบบต้องมีผู้ดูแลระบบ (Admin) ที่ใช้งานได้อย่างน้อย 1 คน');
  }
}

const SELECT_USER = `
  SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, u.is_active,
         u.last_login_at, u.created_at, u.updated_at,
         r.code AS role_code, r.name AS role_name, r.is_admin,
         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS order_count
    FROM users u JOIN roles r ON r.id = u.role_id`;

async function list({ q, roleId, status } = {}) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (roleId) { params.push(roleId); where.push(`u.role_id = $${params.length}`); }
  if (status === 'active') where.push('u.is_active');
  if (status === 'inactive') where.push('NOT u.is_active');
  const sql = `${SELECT_USER} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.is_admin DESC, u.role_id, u.username`;
  return (await db.query(sql, params)).rows;
}

async function get(id) {
  const row = (await db.query(`${SELECT_USER} WHERE u.id = $1`, [id])).rows[0];
  if (!row) throw notFound('ไม่พบผู้ใช้');
  return row;
}

function validateUser(input, { isNew }) {
  const v = new Validator(input);
  if (isNew) {
    v.string('username', 'ชื่อผู้ใช้', {
      min: 3, max: 50, pattern: /^[A-Za-z0-9_.]+$/,
      patternMessage: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, A-Z, 0-9, จุด และขีดล่าง',
    });
  }
  v.string('full_name', 'ชื่อ-นามสกุล', { max: 150 })
    .string('email', 'อีเมล', {
      required: false, max: 150, lower: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: 'รูปแบบอีเมลไม่ถูกต้อง',
    })
    .string('phone', 'เบอร์โทร', {
      required: false, max: 20, pattern: /^[0-9+\- ]{9,20}$/, patternMessage: 'เบอร์โทรใช้ตัวเลข ช่องว่าง + และ - (9–20 ตัว)',
    })
    .int('role_id', 'บทบาท', { min: 1 })
    .bool('is_active');
  const password = typeof input.password === 'string' ? input.password : '';
  if (isNew || password) {
    checkPasswordPolicy(v, 'password', password);
    if (password !== input.password_confirm) v.error('password_confirm', 'ยืนยันรหัสผ่านไม่ตรงกัน');
  }
  const data = v.done();
  data.password = password || null;
  return data;
}

function mapUniqueError(err) {
  if (err.code === '23505') {
    if (/username/.test(err.constraint || err.detail || '')) return validation({ username: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
    if (/email/.test(err.constraint || err.detail || '')) return validation({ email: 'อีเมลนี้ถูกใช้แล้ว' });
  }
  return err;
}

async function assertRoleExists(client, roleId) {
  const role = (await client.query('SELECT id, code FROM roles WHERE id=$1', [roleId])).rows[0];
  if (!role) throw validation({ role_id: 'ไม่พบบทบาทที่เลือก' });
  return role;
}

async function create(req, input) {
  const data = validateUser(input, { isNew: true });
  const hash = await hashPassword(data.password);
  let user;
  try {
    user = await db.withTransaction(async (client) => {
      const role = await assertRoleExists(client, data.role_id);
      const row = (await client.query(
        `INSERT INTO users (username, full_name, email, phone, password_hash, role_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, username`,
        [data.username, data.full_name, data.email, data.phone, hash, data.role_id, data.is_active],
      )).rows[0];
      return { ...row, roleCode: role.code };
    });
  } catch (err) { throw mapUniqueError(err); }
  await audit(req, {
    category: 'admin', action: 'user.create', resourceType: 'user', resourceId: user.id,
    details: { username: user.username, role: user.roleCode, active: data.is_active },
  });
  return user;
}

async function update(req, id, input) {
  const data = validateUser(input, { isNew: false });
  if (id === req.user.id && !data.is_active) {
    throw validation({ is_active: 'ไม่สามารถปิดใช้งานบัญชีของตนเองได้' });
  }
  let result;
  try {
    result = await db.withTransaction(async (client) => {
      const before = (await client.query(
        `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 FOR UPDATE OF u`,
        [id],
      )).rows[0];
      if (!before) throw notFound('ไม่พบผู้ใช้');
      const role = await assertRoleExists(client, data.role_id);
      const params = [data.full_name, data.email, data.phone, data.role_id, data.is_active, id];
      let sql = `UPDATE users SET full_name=$1, email=$2, phone=$3, role_id=$4, is_active=$5`;
      if (data.password) {
        params.push(await hashPassword(data.password));
        sql += `, password_hash=$${params.length}`;
      }
      await client.query(`${sql} WHERE id=$6`, params);
      await ensureAdminRemains(client);
      return { before, newRoleCode: role.code };
    });
  } catch (err) { throw mapUniqueError(err); }

  const { before, newRoleCode } = result;
  const changed = {};
  if (before.full_name !== data.full_name) changed.full_name = [before.full_name, data.full_name];
  if ((before.email || null) !== data.email) changed.email = [before.email, data.email];
  if ((before.phone || null) !== data.phone) changed.phone = [before.phone, data.phone];
  if (before.is_active !== data.is_active) changed.is_active = [before.is_active, data.is_active];
  if (data.password) changed.password_reset = true;

  await audit(req, {
    category: 'admin', action: 'user.update', resourceType: 'user', resourceId: id,
    details: { username: before.username, changes: changed },
  });
  if (before.role_id !== data.role_id) {
    await audit(req, {
      category: 'admin', action: 'user.role_change', resourceType: 'user', resourceId: id,
      details: { username: before.username, from: before.role_code, to: newRoleCode },
    });
  }
}

async function remove(req, id) {
  if (id === req.user.id) throw forbidden('ไม่สามารถลบบัญชีของตนเองได้');
  const user = await db.withTransaction(async (client) => {
    const row = (await client.query('SELECT id, username FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw notFound('ไม่พบผู้ใช้');
    const n = (await client.query('SELECT COUNT(*) AS n FROM orders WHERE customer_id=$1', [id])).rows[0].n;
    if (n > 0) throw conflict(`ผู้ใช้นี้มีประวัติออเดอร์ ${n} รายการ จึงลบไม่ได้ — ให้ปิดการใช้งานบัญชีแทน`);
    await client.query('DELETE FROM user_sessions WHERE (sess->>\'userId\')::int = $1', [id]);
    await client.query('DELETE FROM users WHERE id=$1', [id]);
    await ensureAdminRemains(client);
    return row;
  });
  await audit(req, {
    category: 'admin', action: 'user.delete', resourceType: 'user', resourceId: id,
    details: { username: user.username },
  });
}

async function changeOwnPassword(req, input) {
  const v = new Validator(input);
  if (!input.current_password) v.error('current_password', 'กรุณากรอกรหัสผ่านปัจจุบัน');
  checkPasswordPolicy(v, 'new_password', input.new_password || '', 'รหัสผ่านใหม่');
  if (input.new_password !== input.new_password_confirm) v.error('new_password_confirm', 'ยืนยันรหัสผ่านไม่ตรงกัน');
  v.done();

  const row = (await db.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  const ok = await bcrypt.compare(input.current_password, row.password_hash);
  if (!ok) {
    await audit(req, { category: 'auth', action: 'password_change', result: 'failure', resourceType: 'user', resourceId: req.user.id, details: { reason: 'wrong_current_password' } });
    throw validation({ current_password: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPassword(input.new_password), req.user.id]);
  await audit(req, { category: 'auth', action: 'password_change', resourceType: 'user', resourceId: req.user.id });
}

async function listForFilter() {
  return (await db.query('SELECT id, username, full_name FROM users ORDER BY username')).rows;
}

module.exports = {
  authenticate, hashPassword, ensureAdminRemains, list, get, create, update, remove,
  changeOwnPassword, listForFilter,
};
