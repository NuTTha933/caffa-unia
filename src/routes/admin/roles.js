// /admin/roles — เพิ่ม แก้ไข ลบ Role ผ่านเว็บ (ไม่ต้องแก้ Source Code)
const express = require('express');
const roleService = require('../../services/roleService');
const { authorize } = require('../../middleware/acl');
const { idParam, withFlashBack } = require('../helpers');

const router = express.Router();
router.use(authorize('admin.roles'));

router.get('/', async (req, res) => {
  res.render('admin/roles/list', { title: 'บทบาท (Role)', roles: await roleService.list() });
});

async function renderForm(res, status, { role = null, values = {}, errors = {} } = {}) {
  return res.status(status).render('admin/roles/form', {
    title: role ? `แก้ไขบทบาท ${role.name}` : 'เพิ่มบทบาท',
    role, values, errors, roles: await roleService.options(),
  });
}

router.get('/new', (req, res) => renderForm(res, 200));

router.post('/', async (req, res) => {
  try {
    const role = await roleService.create(req, req.body);
    req.flash('success', `เพิ่มบทบาท "${role.name}" แล้ว — กำหนดสิทธิ์ได้ที่หน้า ACL`);
    res.redirect(`/admin/roles/${role.id}`);
  } catch (err) {
    if (err.status === 422) return renderForm(res, 422, { values: req.body, errors: err.errors });
    throw err;
  }
});

router.get('/:id', async (req, res) => {
  const role = await roleService.get(idParam(req));
  res.render('admin/roles/detail', { title: role.name, role });
});

router.get('/:id/edit', async (req, res) => {
  const role = await roleService.get(idParam(req));
  await renderForm(res, 200, { role, values: role });
});

router.post('/:id/edit', async (req, res) => {
  const id = idParam(req);
  try {
    await roleService.update(req, id, req.body);
    req.flash('success', 'บันทึกการแก้ไขบทบาทแล้ว');
    res.redirect(`/admin/roles/${id}`);
  } catch (err) {
    if (err.status === 422) return renderForm(res, 422, { role: await roleService.get(id), values: req.body, errors: err.errors });
    throw err;
  }
});

router.post('/:id/delete', withFlashBack(async (req, res) => {
  await roleService.remove(req, idParam(req));
  req.flash('success', 'ลบบทบาทเรียบร้อยแล้ว');
  res.redirect('/admin/roles');
}, '/admin/roles'));

module.exports = router;
