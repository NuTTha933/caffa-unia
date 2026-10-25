// /admin/users — จัดการผู้ใช้และกำหนด Role ผ่านเว็บ
const express = require('express');
const userService = require('../../services/userService');
const roleService = require('../../services/roleService');
const { authorize } = require('../../middleware/acl');
const { idParam, withFlashBack } = require('../helpers');

const router = express.Router();
router.use(authorize('admin.users'));

router.get('/', async (req, res) => {
  const filters = {
    q: String(req.query.q || '').trim().slice(0, 100),
    role_id: /^\d+$/.test(String(req.query.role_id || '')) ? Number(req.query.role_id) : '',
    status: ['active', 'inactive'].includes(req.query.status) ? req.query.status : '',
  };
  res.render('admin/users/list', {
    title: 'ผู้ใช้',
    users: await userService.list({ q: filters.q, roleId: filters.role_id, status: filters.status }),
    roles: await roleService.options(),
    filters,
  });
});

async function renderForm(res, status, { user = null, values = {}, errors = {} } = {}) {
  return res.status(status).render('admin/users/form', {
    title: user ? `แก้ไขผู้ใช้ ${user.username}` : 'เพิ่มผู้ใช้',
    user, values, errors, roles: await roleService.options(),
  });
}

router.get('/new', async (req, res) => {
  const roles = await roleService.options();
  const member = roles.find((r) => r.code === 'customer');
  await renderForm(res, 200, { values: { is_active: true, role_id: member ? member.id : '' } });
});

router.post('/', async (req, res) => {
  try {
    const u = await userService.create(req, req.body);
    req.flash('success', `เพิ่มผู้ใช้ ${u.username} เรียบร้อยแล้ว`);
    res.redirect('/admin/users');
  } catch (err) {
    if (err.status === 422) return renderForm(res, 422, { values: { ...req.body, is_active: !!req.body.is_active }, errors: err.errors });
    throw err;
  }
});

router.get('/:id/edit', async (req, res) => {
  const user = await userService.get(idParam(req));
  await renderForm(res, 200, { user, values: user });
});

router.post('/:id/edit', async (req, res) => {
  const id = idParam(req);
  try {
    await userService.update(req, id, req.body);
    req.flash('success', 'บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว');
    res.redirect('/admin/users');
  } catch (err) {
    const user = await userService.get(id);
    const values = { ...req.body, is_active: !!req.body.is_active };
    if (err.status === 422) return renderForm(res, 422, { user, values, errors: err.errors });
    if (err.status === 409) {
      return renderForm(res, 409, { user, values, errors: { _form: err.message } });
    }
    throw err;
  }
});

router.post('/:id/delete', withFlashBack(async (req, res) => {
  await userService.remove(req, idParam(req));
  req.flash('success', 'ลบผู้ใช้เรียบร้อยแล้ว');
  res.redirect('/admin/users');
}, '/admin/users'));

module.exports = router;
