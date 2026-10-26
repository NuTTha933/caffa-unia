const express = require('express');
const userService = require('../../services/userService');
const roleService = require('../../services/roleService');
const permissionService = require('../../services/permissionService');
const aclService = require('../../services/aclService');
const { authorize } = require('../../middleware/acl');
const { idParam } = require('../helpers');

const router = express.Router();

const userJson = (u) => ({
  id: u.id, username: u.username, full_name: u.full_name, email: u.email, phone: u.phone,
  role: { id: u.role_id, code: u.role_code, name: u.role_name }, is_active: u.is_active,
  last_login_at: u.last_login_at, created_at: u.created_at,
});

router.get('/users', authorize('admin.users'), async (req, res) => {
  res.json({ data: (await userService.list({ q: req.query.q })).map(userJson) });
});
router.post('/users', authorize('admin.users'), async (req, res) => {
  const u = await userService.create(req, req.body || {});
  res.status(201).json({ data: userJson(await userService.get(u.id)) });
});
router.put('/users/:id', authorize('admin.users'), async (req, res) => {
  const id = idParam(req);
  const current = await userService.get(id);
  const body = { full_name: current.full_name, email: current.email, phone: current.phone,
    role_id: current.role_id, is_active: current.is_active, ...(req.body || {}) };
  await userService.update(req, id, body);
  res.json({ data: userJson(await userService.get(id)) });
});
router.delete('/users/:id', authorize('admin.users'), async (req, res) => {
  await userService.remove(req, idParam(req));
  res.json({ ok: true });
});

router.get('/roles', authorize('admin.roles'), async (req, res) => {
  res.json({ data: await roleService.list() });
});
router.post('/roles', authorize('admin.roles'), async (req, res) => {
  res.status(201).json({ data: await roleService.create(req, req.body || {}) });
});
router.put('/roles/:id', authorize('admin.roles'), async (req, res) => {
  const id = idParam(req);
  await roleService.update(req, id, req.body || {});
  res.json({ data: await roleService.get(id) });
});
router.delete('/roles/:id', authorize('admin.roles'), async (req, res) => {
  await roleService.remove(req, idParam(req));
  res.json({ ok: true });
});

router.get('/permissions', authorize('admin.permissions'), async (req, res) => {
  res.json({ data: await permissionService.list() });
});
router.get('/functions', authorize('admin.permissions'), async (req, res) => {
  res.json({ data: await permissionService.functionOptions() });
});
router.post('/permissions', authorize('admin.permissions'), async (req, res) => {
  res.status(201).json({ data: await permissionService.create(req, req.body || {}) });
});
router.put('/permissions/:id', authorize('admin.permissions'), async (req, res) => {
  const id = idParam(req);
  await permissionService.update(req, id, req.body || {});
  res.json({ data: await permissionService.get(id) });
});
router.delete('/permissions/:id', authorize('admin.permissions'), async (req, res) => {
  await permissionService.remove(req, idParam(req));
  res.json({ ok: true });
});

router.get('/acl', authorize('admin.acl'), async (req, res) => {
  const m = await aclService.getMatrix();
  res.json({
    roles: m.roles.map((r) => ({ id: r.id, code: r.code, name: r.name, is_admin: r.is_admin })),
    permissions: m.permissions.map((p) => ({ id: p.id, code: p.code, name: p.name, functions: p.function_codes })),
    grants: [...m.granted].map((k) => { const [role_id, permission_id] = k.split(':').map(Number); return { role_id, permission_id }; }),
  });
});
router.put('/acl', authorize('admin.acl'), async (req, res) => {
  const b = req.body || {};
  const roleId = Number(b.role_id);
  const permId = Number(b.permission_id);
  if (!Number.isInteger(roleId) || !Number.isInteger(permId) || typeof b.granted !== 'boolean') {
    return res.status(422).json({ error: 'validation_error', message: 'ต้องส่ง role_id, permission_id (ตัวเลข) และ granted (true/false)' });
  }
  res.json({ data: await aclService.setGrant(req, roleId, permId, b.granted) });
});

router.get('/access-matrix', authorize('admin.acl'), async (req, res) => {
  const m = await aclService.accessMatrix();
  res.json({
    roles: m.roles.map((r) => r.code),
    functions: m.functions.map((f) => ({
      code: f.code, name: f.name,
      access: Object.fromEntries(m.roles.map((r) => [r.code, r.is_admin ? ['*'] : (m.cell.get(`${r.id}:${f.id}`) || [])])),
    })),
  });
});

router.use((req, res) => res.status(404).json({ error: 'not_found', message: 'ไม่พบ API ที่ต้องการ' }));

module.exports = router;
