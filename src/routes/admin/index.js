// =====================================================================
//  ส่วน Admin /admin/... (แยกทาง Logical: กลุ่ม Route, เมนู, หน้า และการตรวจสิทธิ์)
//  ทุก Route ผ่าน requireAuth + adminAreaGate จาก app.js แล้ว และตรวจสิทธิ์รายฟังก์ชันซ้ำอีกชั้น
// =====================================================================
const express = require('express');
const db = require('../../db');
const aclService = require('../../services/aclService');
const { authorize } = require('../../middleware/acl');
const { MODULE_LABELS } = require('../../utils/format');

const router = express.Router();

router.use((req, res, next) => {
  res.locals.area = 'admin';
  next();
});

router.get('/', async (req, res) => {
  const counts = (await db.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM users WHERE NOT is_active) AS inactive_users,
            (SELECT COUNT(*) FROM roles) AS roles,
            (SELECT COUNT(*) FROM permissions) AS permissions,
            (SELECT COUNT(*) FROM app_functions) AS functions,
            (SELECT COUNT(*) FROM role_permissions) AS grants,
            (SELECT COUNT(*) FROM audit_logs WHERE result='denied' AND created_at > now() - interval '1 day') AS denied_today,
            (SELECT COUNT(*) FROM audit_logs WHERE action='login_failed' AND created_at > now() - interval '1 day') AS failed_logins_today`,
  )).rows[0];
  const recentAdmin = (await db.query(
    `SELECT * FROM audit_logs WHERE category IN ('admin','access') OR action='login_failed'
      ORDER BY created_at DESC LIMIT 8`,
  )).rows;
  res.render('admin/dashboard', { title: 'ส่วนผู้ดูแลระบบ', counts, recentAdmin });
});

router.use('/users', require('./users'));
router.use('/roles', require('./roles'));
router.use('/permissions', require('./permissions'));
router.use('/acl', require('./acl'));

// Access Matrix (Role × ฟังก์ชัน) คำนวณจากข้อมูล ACL จริง
router.get('/access-matrix', authorize('admin.acl'), async (req, res) => {
  const m = await aclService.accessMatrix();
  res.render('admin/acl/matrix', { title: 'Access Matrix', m, MODULE_LABELS });
});

module.exports = router;
