// /admin/acl — ตาราง ACL รูปแบบ Role × Permission (ติ๊กเพื่อกำหนด / เอาออกเพื่อยกเลิก)
const express = require('express');
const aclService = require('../../services/aclService');
const { authorize } = require('../../middleware/acl');
const { PERMISSION_GROUPS } = require('../../utils/format');

const router = express.Router();
router.use(authorize('admin.acl'));

router.get('/', async (req, res) => {
  const m = await aclService.getMatrix();
  // จัดกลุ่ม Permission ตามทรัพยากร (ส่วนหน้าจุด)
  const groups = [];
  for (const p of m.permissions) {
    const key = p.code.split('.')[0];
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, items: [] }; groups.push(g); }
    g.items.push(p);
  }
  // เรียงกลุ่มตามลำดับงานของร้าน (เมนู → ออเดอร์ → สลิป → รายงาน → Log → ส่วน Admin)
  const order = Object.keys(PERMISSION_GROUPS);
  const rank = (k) => (order.indexOf(k) < 0 ? 99 : order.indexOf(k));
  groups.sort((a, b) => rank(a.key) - rank(b.key));
  res.render('admin/acl/index', { title: 'กำหนดสิทธิ์ ACL', roles: m.roles, groups, granted: m.granted });
});

router.post('/', async (req, res) => {
  const g = req.body.grant;
  const pairs = g === undefined ? [] : Array.isArray(g) ? g : typeof g === 'object' ? Object.values(g) : [g];
  const changes = await aclService.saveMatrix(req, pairs);
  const n = changes.granted.length + changes.revoked.length;
  req.flash(n ? 'success' : 'info', n
    ? `บันทึก ACL แล้ว: กำหนดสิทธิ์ ${changes.granted.length} รายการ, ยกเลิก ${changes.revoked.length} รายการ (มีผลทันที ไม่ต้องเริ่ม Server ใหม่)`
    : 'ไม่มีการเปลี่ยนแปลงสิทธิ์');
  res.redirect('/admin/acl');
});

module.exports = router;
