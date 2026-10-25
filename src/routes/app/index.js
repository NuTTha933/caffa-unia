// ส่วนผู้ใช้ทั่วไป /app/... (ทุก Route ผ่าน requireAuth แล้วจาก app.js)
const express = require('express');
const db = require('../../db');
const orderService = require('../../services/orderService');

const router = express.Router();

// หน้าหลัก — แสดงข้อมูลตามสิทธิ์ของแต่ละ Role
router.get('/', async (req, res) => {
  const can = req.can;
  const data = { title: 'หน้าหลัก', today: null, review: [], queue: null, mine: [], active: null };

  if (can('order.review')) {
    data.review = (await orderService.list(req.user, { status: 'pending', pageSize: 6 })).rows;
  }
  if (can('order.view_all') || can('order.review')) {
    data.today = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('accepted','brewing','ready','completed')) AS paid,
              COALESCE(SUM(total_amount) FILTER (WHERE status IN ('accepted','brewing','ready','completed')), 0) AS revenue,
              COUNT(*) FILTER (WHERE status = 'pending') AS pending,
              COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
         FROM orders WHERE created_at >= date_trunc('day', now())`,
    )).rows[0];
  }
  if (can('order.view_queue')) {
    const q = await orderService.queue(req.user);
    data.queue = { accepted: q.accepted.length, brewing: q.brewing.length, ready: q.ready.length, next: q.accepted.slice(0, 3) };
  }
  if (can('order.view_own')) {
    data.mine = (await orderService.list(req.user, { mine: true, pageSize: 5 })).rows;
    data.active = data.mine.find((o) => ['pending', 'accepted', 'brewing', 'ready'].includes(o.status)) || null;
  }
  data.myPermissions = [...req.user.permissions].sort();
  res.render('app/dashboard', data);
});

router.use('/menu', require('./menu'));
router.use('/orders', require('./orders'));
router.use('/queue', require('./queue'));
router.use('/files', require('./files'));
router.use('/reports', require('./reports'));
router.use('/logs', require('./logs'));
router.use('/profile', require('./profile'));

module.exports = router;
