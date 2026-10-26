const db = require('../db');
const { audit } = require('./auditService');
const { notFound, badRequest } = require('../utils/httpError');

async function loadAccess(userId) {
  const u = (await db.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.role_id,
            r.code AS role_code, r.name AS role_name, r.is_admin
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [userId],
  )).rows[0];
  if (!u) return null;

  let fnRows;
  let permRows;
  if (u.is_admin) {
    fnRows = (await db.query('SELECT code FROM app_functions')).rows;
    permRows = (await db.query('SELECT code FROM permissions')).rows;
  } else {
    fnRows = (await db.query(
      `SELECT DISTINCT f.code
         FROM role_permissions rp
         JOIN permission_functions pf ON pf.permission_id = rp.permission_id
         JOIN app_functions f ON f.id = pf.function_id
        WHERE rp.role_id = $1`,
      [u.role_id],
    )).rows;
    permRows = (await db.query(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1`,
      [u.role_id],
    )).rows;
  }

  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    isActive: u.is_active,
    roleId: u.role_id,
    roleCode: u.role_code,
    roleName: u.role_name,
    isAdmin: u.is_admin,
    functions: new Set(fnRows.map((r) => r.code)),
    permissions: new Set(permRows.map((r) => r.code)),
  };
}

function can(user, functionCode) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.functions.has(functionCode);
}

async function getMatrix() {
  const roles = (await db.query(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r ORDER BY r.is_admin DESC, r.id`,
  )).rows;
  const permissions = (await db.query(
    `SELECT p.*,
            COALESCE(array_agg(f.code ORDER BY f.sort_order) FILTER (WHERE f.id IS NOT NULL), '{}') AS function_codes
       FROM permissions p
       LEFT JOIN permission_functions pf ON pf.permission_id = p.id
       LEFT JOIN app_functions f ON f.id = pf.function_id
      GROUP BY p.id
      ORDER BY split_part(p.code, '.', 1), p.code`,
  )).rows;
  const grants = (await db.query('SELECT role_id, permission_id FROM role_permissions')).rows;
  const granted = new Set(grants.map((g) => `${g.role_id}:${g.permission_id}`));
  return { roles, permissions, granted };
}

async function saveMatrix(req, checkedPairs) {
  const wanted = new Set(
    (checkedPairs || []).filter((s) => /^\d+:\d+$/.test(s)),
  );
  const changes = await db.withTransaction(async (client) => {
    const roles = (await client.query('SELECT id, code, name, is_admin FROM roles')).rows;
    const perms = (await client.query('SELECT id, code FROM permissions')).rows;
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const permById = new Map(perms.map((p) => [p.id, p]));
    const current = new Set(
      (await client.query('SELECT role_id, permission_id FROM role_permissions')).rows
        .map((g) => `${g.role_id}:${g.permission_id}`),
    );

    const result = { granted: [], revoked: [] };
    for (const role of roles) {
      if (role.is_admin) continue;
      for (const perm of perms) {
        const key = `${role.id}:${perm.id}`;
        const has = current.has(key);
        const want = wanted.has(key);
        if (want && !has) {
          await client.query(
            'INSERT INTO role_permissions (role_id, permission_id, granted_by) VALUES ($1,$2,$3)',
            [role.id, perm.id, req.user.id],
          );
          result.granted.push({ role: role.code, permission: perm.code, roleId: role.id, permissionId: perm.id });
        } else if (!want && has) {
          await client.query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2', [role.id, perm.id]);
          result.revoked.push({ role: role.code, permission: perm.code, roleId: role.id, permissionId: perm.id });
        }
      }
    }
    for (const key of wanted) {
      const [rid, pid] = key.split(':').map(Number);
      if (!roleById.has(rid) || !permById.has(pid)) throw badRequest('ข้อมูล ACL ไม่ถูกต้อง');
    }
    return result;
  });

  for (const g of changes.granted) {
    await audit(req, {
      category: 'admin', action: 'acl.grant', resourceType: 'role', resourceId: g.roleId,
      details: { role: g.role, permission: g.permission },
    });
  }
  for (const g of changes.revoked) {
    await audit(req, {
      category: 'admin', action: 'acl.revoke', resourceType: 'role', resourceId: g.roleId,
      details: { role: g.role, permission: g.permission },
    });
  }
  return changes;
}

async function setGrant(req, roleId, permissionId, grant) {
  const role = (await db.query('SELECT id, code, is_admin FROM roles WHERE id=$1', [roleId])).rows[0];
  const perm = (await db.query('SELECT id, code FROM permissions WHERE id=$1', [permissionId])).rows[0];
  if (!role || !perm) throw notFound('ไม่พบ Role หรือ Permission');
  if (role.is_admin) throw badRequest('Role ผู้ดูแลระบบได้ทุกสิทธิ์เสมอ ไม่สามารถแก้ไขได้');

  let changed = false;
  if (grant) {
    const r = await db.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_by) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [role.id, perm.id, req.user.id],
    );
    changed = r.rowCount > 0;
  } else {
    const r = await db.query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2', [role.id, perm.id]);
    changed = r.rowCount > 0;
  }
  if (changed) {
    await audit(req, {
      category: 'admin', action: grant ? 'acl.grant' : 'acl.revoke', resourceType: 'role', resourceId: role.id,
      details: { role: role.code, permission: perm.code },
    });
  }
  return { role: role.code, permission: perm.code, granted: grant, changed };
}

async function accessMatrix() {
  const roles = (await db.query('SELECT id, code, name, is_admin FROM roles ORDER BY is_admin DESC, id')).rows;
  const functions = (await db.query('SELECT * FROM app_functions ORDER BY sort_order, code')).rows;
  const links = (await db.query(
    `SELECT rp.role_id, pf.function_id, p.code AS permission_code
       FROM role_permissions rp
       JOIN permission_functions pf ON pf.permission_id = rp.permission_id
       JOIN permissions p ON p.id = rp.permission_id`,
  )).rows;
  const fnPerms = (await db.query(
    `SELECT pf.function_id, p.code FROM permission_functions pf JOIN permissions p ON p.id = pf.permission_id
      ORDER BY p.code`,
  )).rows;

  const cell = new Map();
  for (const l of links) {
    const key = `${l.role_id}:${l.function_id}`;
    if (!cell.has(key)) cell.set(key, []);
    cell.get(key).push(l.permission_code);
  }
  const permsByFunction = new Map();
  for (const r of fnPerms) {
    if (!permsByFunction.has(r.function_id)) permsByFunction.set(r.function_id, []);
    permsByFunction.get(r.function_id).push(r.code);
  }
  return { roles, functions, cell, permsByFunction };
}

module.exports = { loadAccess, can, getMatrix, saveMatrix, setGrant, accessMatrix };
