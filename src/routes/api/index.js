// =====================================================================
//  REST API /api/... (ใช้ Session เดียวกับหน้าเว็บ) — ตรวจสิทธิ์ด้วย Middleware ชุดเดียวกัน
//  ไม่มีสิทธิ์ → 403 JSON, ยังไม่เข้าสู่ระบบ → 401 JSON
// =====================================================================
const express = require('express');
const menuService = require('../../services/menuService');
const orderService = require('../../services/orderService');
const reportService = require('../../services/reportService');
const auditService = require('../../services/auditService');
const fileService = require('../../services/fileService');
const { audit } = auditService;
const { authorize } = require('../../middleware/acl');
const { idParam, pageParam } = require('../helpers');
const { orderNo } = require('../../utils/format');

const router = express.Router();
const VIEW = ['order.view_own', 'order.view_queue', 'order.view_all'];

router.get('/me', (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, username: u.username, full_name: u.fullName,
    role: { id: u.roleId, code: u.roleCode, name: u.roleName, is_admin: u.isAdmin },
    permissions: [...u.permissions].sort(),
    functions: [...u.functions].sort(),
  });
});

// ---------------- เมนู ----------------
const menuJson = (m) => ({
  id: m.id, code: m.code, name: m.name, category: m.category_name, description: m.description,
  price: Number(m.price), is_available: m.is_available,
  image_url: m.image_id ? `/app/files/${m.image_id}` : null, updated_at: m.updated_at,
});

router.get('/menu', authorize('menu.view'), async (req, res) => {
  const items = await menuService.list({ q: String(req.query.q || '').slice(0, 100), availableOnly: req.query.available === '1' });
  res.json({ data: items.map(menuJson) });
});

router.get('/menu/:id', authorize('menu.view'), async (req, res) => {
  res.json({ data: menuJson(await menuService.get(idParam(req))) });
});

router.post('/menu', authorize('menu.create'), async (req, res) => {
  const m = await menuService.create(req, req.body || {});
  res.status(201).json({ data: menuJson(await menuService.get(m.id)) });
});

router.put('/menu/:id', authorize('menu.update'), async (req, res) => {
  const m = await menuService.update(req, idParam(req), req.body || {});
  res.json({ data: menuJson(await menuService.get(m.id)) });
});

router.post('/menu/:id/availability', authorize('menu.toggle'), async (req, res) => {
  const body = req.body || {};
  const available = body.available === true || body.available === '1' || body.available === 1;
  const m = await menuService.setAvailability(req, idParam(req), available);
  res.json({ data: menuJson(await menuService.get(m.id)) });
});

router.delete('/menu/:id', authorize('menu.delete'), async (req, res) => {
  await menuService.remove(req, idParam(req));
  res.json({ ok: true });
});

// ---------------- ออเดอร์ ----------------
const orderJson = (o) => ({
  id: o.id, order_no: orderNo(o.id), status: o.status, total_amount: Number(o.total_amount),
  customer: { id: o.customer_id, username: o.customer_username, full_name: o.customer_name },
  summary: o.summary, cups: o.cups, note: o.note, review_note: o.review_note,
  has_slip: o.slip_count > 0, created_at: o.created_at, reviewed_at: o.reviewed_at,
  brewing_at: o.brewing_at, ready_at: o.ready_at, completed_at: o.completed_at,
});

router.get('/orders', authorize(...VIEW), async (req, res) => {
  const result = await orderService.list(req.user, {
    status: req.query.status, q: String(req.query.q || '').slice(0, 100),
    mine: req.query.mine === '1', page: pageParam(req),
  });
  res.json({ data: result.rows.map(orderJson), total: result.total, page: result.page, pages: result.pages });
});

router.get('/queue', authorize('order.view_queue', 'order.view_all'), async (req, res) => {
  const q = await orderService.queue(req.user);
  const pack = (rows) => rows.map((o) => ({
    ...orderJson(o),
    items: (o.items || []).map((i) => ({ name: i.item_name, quantity: i.quantity })),
  }));
  res.json({ data: { accepted: pack(q.accepted), brewing: pack(q.brewing), ready: pack(q.ready) } });
});

router.get('/orders/:id', authorize(...VIEW), async (req, res) => {
  const o = await orderService.detail(req.user, idParam(req));
  res.json({
    data: {
      ...orderJson(o),
      items: o.items.map((i) => ({
        menu_item_id: i.menu_item_id, name: i.item_name, unit_price: Number(i.unit_price),
        quantity: i.quantity, line_total: Number(i.line_total),
      })),
      slips: o.canSeeSlip ? o.slips.map((f) => ({
        id: f.id, original_name: f.original_name, mime_type: f.mime_type, size_bytes: f.size_bytes,
        uploaded_at: f.uploaded_at, url: `/api/files/${f.id}`,
      })) : undefined,
      history: o.history.map((h) => ({ from: h.from_status, to: h.to_status, by: h.changed_by_name, note: h.note, at: h.changed_at })),
      allowed_actions: o.actions,
    },
  });
});

router.post('/orders', authorize('order.create'), async (req, res) => {
  const o = await orderService.create(req, req.body || {});
  res.status(201).json({ data: { id: o.id, order_no: orderNo(o.id), status: o.status, total_amount: Number(o.total_amount) } });
});

const action = (fnCode, run) => [authorize(fnCode), async (req, res) => {
  const id = idParam(req);
  await run(req, id);
  const o = await orderService.detail(req.user, id).catch(() => null);
  res.json({ ok: true, data: o ? orderJson(o) : { id } });
}];

router.post('/orders/:id/accept', ...action('order.review', (req, id) => orderService.accept(req, id, req.body || {})));
router.post('/orders/:id/reject', ...action('order.review', (req, id) => orderService.reject(req, id, req.body || {})));
router.post('/orders/:id/brew', ...action('order.brew', (req, id) => orderService.brew(req, id)));
router.post('/orders/:id/ready', ...action('order.brew', (req, id) => orderService.markReady(req, id)));
router.post('/orders/:id/complete', ...action('order.serve', (req, id) => orderService.complete(req, id)));
router.post('/orders/:id/cancel', ...action('order.cancel_own', (req, id) => orderService.cancel(req, id)));

router.delete('/orders/:id', authorize('order.delete'), async (req, res) => {
  await orderService.remove(req, idParam(req));
  res.json({ ok: true });
});

// ---------------- ไฟล์ ----------------
router.get('/files/:id', authorize('slip.view', 'menu.view'), async (req, res) => {
  const file = await fileService.getFile(req.params.id);
  await orderService.assertCanViewFile(req.user, file);
  await audit(req, {
    category: 'file', action: 'file.download', resourceType: file.order_id ? 'order' : 'menu',
    resourceId: file.order_id || file.menu_item_id,
    details: { file_id: file.id, kind: file.kind, original_name: file.original_name, via: 'api' },
  });
  res.set('Cache-Control', 'private, no-store');
  res.download(fileService.storedPath(file.stored_name), file.original_name, { headers: { 'Content-Type': file.mime_type } });
});

router.delete('/files/:id', authorize('slip.delete'), async (req, res) => {
  const orderId = await orderService.deleteSlip(req, req.params.id);
  res.json({ ok: true, order_id: orderId });
});

// ---------------- รายงาน / Log ----------------
router.get('/reports/sales', authorize('report.sales'), async (req, res) => {
  res.json({ data: await reportService.sales() });
});

router.get('/logs', authorize('log.view', 'log.view_all'), async (req, res) => {
  const viewAll = req.can('log.view_all');
  const allowed = auditService.categoriesFor(viewAll);
  const q = req.query;
  const filters = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : null,
    to: /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : null,
    userId: /^\d+$/.test(q.user_id || '') ? Number(q.user_id) : null,
    category: allowed.includes(q.category) ? q.category : null,
    action: q.action ? String(q.action).slice(0, 60) : null,
    result: ['success', 'failure', 'denied'].includes(q.result) ? q.result : null,
  };
  const result = await auditService.search(filters, { allowedCategories: viewAll ? null : allowed, page: pageParam(req) });
  res.json({ data: result.rows, total: result.total, page: result.page, pages: result.pages });
});

router.use((req, res) => res.status(404).json({ error: 'not_found', message: 'ไม่พบ API ที่ต้องการ' }));

module.exports = router;
