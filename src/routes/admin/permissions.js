const express = require('express');
const permissionService = require('../../services/permissionService');
const { authorize } = require('../../middleware/acl');
const { idParam, withFlashBack } = require('../helpers');
const { MODULE_LABELS } = require('../../utils/format');

const router = express.Router();
router.use(authorize('admin.permissions'));

router.get('/', async (req, res) => {
  res.render('admin/permissions/list', { title: 'Permission', permissions: await permissionService.list() });
});

async function renderForm(res, status, { perm = null, values = {}, errors = {} } = {}) {
  const functions = await permissionService.functionOptions();
  const selected = new Set((values.function_ids || []).map(Number));
  return res.status(status).render('admin/permissions/form', {
    title: perm ? `แก้ไข Permission ${perm.code}` : 'เพิ่ม Permission',
    perm, values, errors, functions, selected, MODULE_LABELS,
  });
}

const asArray = (v) => (v === undefined ? [] : [].concat(v));

router.get('/new', (req, res) => renderForm(res, 200));

router.post('/', async (req, res) => {
  try {
    const p = await permissionService.create(req, req.body);
    req.flash('success', `เพิ่ม Permission "${p.code}" แล้ว — กำหนดให้ Role ได้ที่หน้า ACL`);
    res.redirect('/admin/permissions');
  } catch (err) {
    if (err.status === 422) {
      return renderForm(res, 422, { values: { ...req.body, function_ids: asArray(req.body.function_ids) }, errors: err.errors });
    }
    throw err;
  }
});

router.get('/:id/edit', async (req, res) => {
  const perm = await permissionService.get(idParam(req));
  await renderForm(res, 200, { perm, values: perm });
});

router.post('/:id/edit', async (req, res) => {
  const id = idParam(req);
  try {
    await permissionService.update(req, id, req.body);
    req.flash('success', 'บันทึกการแก้ไข Permission แล้ว (มีผลทันที)');
    res.redirect('/admin/permissions');
  } catch (err) {
    if (err.status === 422) {
      return renderForm(res, 422, {
        perm: await permissionService.get(id),
        values: { ...req.body, function_ids: asArray(req.body.function_ids) },
        errors: err.errors,
      });
    }
    throw err;
  }
});

router.post('/:id/delete', withFlashBack(async (req, res) => {
  await permissionService.remove(req, idParam(req));
  req.flash('success', 'ลบ Permission แล้ว (ยกเลิกจากทุก Role)');
  res.redirect('/admin/permissions');
}, '/admin/permissions'));

module.exports = router;
