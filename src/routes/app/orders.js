const express = require('express');
const orderService = require('../../services/orderService');
const menuService = require('../../services/menuService');
const { describeRule } = require('../../services/fileService');
const { authorize } = require('../../middleware/acl');
const { uploadSingle } = require('../../middleware/upload');
const { idParam, pageParam, withFlashBack } = require('../helpers');
const config = require('../../config');
const { orderNo } = require('../../utils/format');

const router = express.Router();
const VIEW = ['order.view_own', 'order.view_queue', 'order.view_all'];

router.get('/', authorize(...VIEW), async (req, res) => {
  const filters = {
    status: orderService.STATUSES.includes(req.query.status) ? req.query.status : '',
    q: String(req.query.q || '').trim().slice(0, 100),
    mine: req.query.mine === '1' ? '1' : '',
  };
  const result = await orderService.list(req.user, { ...filters, mine: !!filters.mine, page: pageParam(req) });
  res.render('app/orders/list', {
    title: req.can('order.view_all') || req.can('order.view_queue') ? 'ออเดอร์' : 'ออเดอร์ของฉัน',
    result,
    filters,
    counts: await orderService.countByStatus(req.user),
  });
});

async function renderForm(res, status, { values = {}, errors = {} } = {}) {
  const items = await menuService.list();
  return res.status(status).render('app/orders/form', {
    title: 'สั่งเครื่องดื่ม',
    groups: menuService.groupByCategory(items),
    values,
    errors,
    maxQty: orderService.MAX_QTY_PER_LINE,
    maxCups: orderService.MAX_CUPS_PER_ORDER,
  });
}

router.get('/new', authorize('order.create'), async (req, res) => {
  await renderForm(res, 200, { values: { qty: {} } });
});

router.post('/', authorize('order.create'), async (req, res) => {
  try {
    const o = await orderService.create(req, req.body);
    req.flash('success', `รับออเดอร์ ${orderNo(o.id)} แล้ว — ขั้นต่อไป: โอนเงินแล้วแนบสลิปด้านล่าง`);
    res.redirect(`/app/orders/${o.id}`);
  } catch (err) {
    if (err.status === 422) return renderForm(res, 422, { values: req.body, errors: err.errors });
    throw err;
  }
});

router.get('/:id', authorize(...VIEW), async (req, res) => {
  const o = await orderService.detail(req.user, idParam(req));
  res.render('app/orders/detail', {
    title: `ออเดอร์ ${orderNo(o.id)}`,
    o,
    slipRule: describeRule('payment_slip'),
    shop: config.shop,
  });
});

const back = (req) => `/app/orders/${req.params.id}`;
const backFromBar = (req) => (req.body && req.body.back === 'queue' ? '/app/queue' : back(req));

router.post('/:id/accept', authorize('order.review'), withFlashBack(async (req, res) => {
  await orderService.accept(req, idParam(req), req.body);
  req.flash('success', `รับออเดอร์ ${orderNo(req.params.id)} แล้ว — ส่งเข้าคิวบาร์`);
  res.redirect(back(req));
}, back));

router.post('/:id/reject', authorize('order.review'), withFlashBack(async (req, res) => {
  await orderService.reject(req, idParam(req), req.body);
  req.flash('success', 'บันทึกผล "สลิปไม่ผ่าน" แล้ว ลูกค้าจะเห็นเหตุผลในหน้าออเดอร์');
  res.redirect(back(req));
}, back));

router.post('/:id/brew', authorize('order.brew'), withFlashBack(async (req, res) => {
  await orderService.brew(req, idParam(req));
  res.redirect(backFromBar(req));
}, backFromBar));

router.post('/:id/ready', authorize('order.brew'), withFlashBack(async (req, res) => {
  await orderService.markReady(req, idParam(req));
  res.redirect(backFromBar(req));
}, backFromBar));

router.post('/:id/complete', authorize('order.serve'), withFlashBack(async (req, res) => {
  await orderService.complete(req, idParam(req));
  res.redirect(backFromBar(req));
}, backFromBar));

router.post('/:id/cancel', authorize('order.cancel_own'), withFlashBack(async (req, res) => {
  await orderService.cancel(req, idParam(req));
  req.flash('success', 'ยกเลิกออเดอร์แล้ว');
  res.redirect(back(req));
}, back));

router.post('/:id/delete', authorize('order.delete'), withFlashBack(async (req, res) => {
  await orderService.remove(req, idParam(req));
  req.flash('success', `ลบออเดอร์ ${orderNo(req.params.id)} แล้ว`);
  res.redirect('/app/orders');
}, back));

router.post(
  '/:id/slip',
  authorize('slip.upload'),
  uploadSingle('payment_slip', { field: 'slip', resourceType: 'order', redirect: back }),
  withFlashBack(async (req, res) => {
    const f = await orderService.uploadSlip(req, idParam(req), req.file);
    req.flash('success', `แนบสลิป "${f.original_name}" แล้ว — รอร้านตรวจสอบ`);
    res.redirect(back(req));
  }, back),
);

module.exports = router;
