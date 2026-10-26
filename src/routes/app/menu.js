const express = require('express');
const menuService = require('../../services/menuService');
const { authorize } = require('../../middleware/acl');
const { uploadSingle } = require('../../middleware/upload');
const { idParam, withFlashBack } = require('../helpers');
const { describeRule } = require('../../services/fileService');

const router = express.Router();

router.get('/', authorize('menu.view'), async (req, res) => {
  const categories = await menuService.categories();
  const filters = {
    q: String(req.query.q || '').trim().slice(0, 100),
    category: categories.some((c) => String(c.id) === String(req.query.category)) ? String(req.query.category) : '',
  };
  const items = await menuService.list({ q: filters.q, categoryId: filters.category || null });
  res.render('app/menu/list', {
    title: 'เมนู',
    groups: menuService.groupByCategory(items),
    count: items.length,
    soldOut: items.filter((i) => !i.is_available).length,
    categories,
    filters,
  });
});

async function renderForm(res, status, { item = null, values = {}, errors = {} } = {}) {
  return res.status(status).render('app/menu/form', {
    title: item ? `แก้ไขเมนู ${item.code}` : 'เพิ่มเมนู',
    item, values, errors, categories: await menuService.categories(),
  });
}

router.get('/new', authorize('menu.create'), async (req, res) => {
  await renderForm(res, 200, { values: { is_available: true } });
});

router.post('/', authorize('menu.create'), async (req, res) => {
  try {
    const item = await menuService.create(req, req.body);
    req.flash('success', `เพิ่มเมนู ${item.code} ${item.name} แล้ว — แนบภาพเมนูได้ด้านล่าง`);
    res.redirect(`/app/menu/${item.id}`);
  } catch (err) {
    if (err.status === 422) return renderForm(res, 422, { values: { ...req.body, is_available: !!req.body.is_available }, errors: err.errors });
    throw err;
  }
});

router.get('/:id', authorize('menu.view'), async (req, res) => {
  const id = idParam(req);
  const item = await menuService.get(id);
  res.render('app/menu/detail', {
    title: item.name, item, stats: await menuService.stats(id), imageRule: describeRule('menu_image'),
  });
});

router.get('/:id/edit', authorize('menu.update'), async (req, res) => {
  const item = await menuService.get(idParam(req));
  await renderForm(res, 200, { item, values: item });
});

router.post('/:id/edit', authorize('menu.update'), async (req, res) => {
  const id = idParam(req);
  try {
    await menuService.update(req, id, req.body);
    req.flash('success', 'บันทึกการแก้ไขเมนูแล้ว');
    res.redirect(`/app/menu/${id}`);
  } catch (err) {
    if (err.status === 422) {
      const item = await menuService.get(id);
      return renderForm(res, 422, { item, values: { ...req.body, is_available: !!req.body.is_available }, errors: err.errors });
    }
    throw err;
  }
});

const backToItem = (req) => `/app/menu/${req.params.id}`;
const backTo = (req) => (req.body && req.body.back === 'list' ? '/app/menu' : backToItem(req));

router.post('/:id/availability', authorize('menu.toggle'), withFlashBack(async (req, res) => {
  const item = await menuService.setAvailability(req, idParam(req), req.body.available === '1');
  req.flash('success', item.is_available ? `${item.name} กลับมาขายแล้ว` : `ตั้ง ${item.name} เป็น "หมด" แล้ว — ลูกค้าจะสั่งไม่ได้จนกว่าจะเปิดขาย`);
  res.redirect(backTo(req));
}, backTo));

router.post(
  '/:id/image',
  authorize('menu.image'),
  uploadSingle('menu_image', { field: 'image', resourceType: 'menu', redirect: backToItem }),
  withFlashBack(async (req, res) => {
    await menuService.setImage(req, idParam(req), req.file);
    req.flash('success', 'อัปโหลดภาพเมนูแล้ว');
    res.redirect(backToItem(req));
  }, backToItem),
);

router.post('/:id/image/delete', authorize('menu.image'), withFlashBack(async (req, res) => {
  await menuService.removeImage(req, idParam(req));
  req.flash('success', 'ลบภาพเมนูแล้ว');
  res.redirect(backToItem(req));
}, backToItem));

router.post('/:id/delete', authorize('menu.delete'), withFlashBack(async (req, res) => {
  await menuService.remove(req, idParam(req));
  req.flash('success', 'ลบเมนูแล้ว');
  res.redirect('/app/menu');
}, backToItem));

module.exports = router;
