// =====================================================================
//  /app/queue — คิวบาร์ (บาริสต้า): รอชง → กำลังชง → พร้อมรับ
// =====================================================================
const express = require('express');
const orderService = require('../../services/orderService');
const { authorize } = require('../../middleware/acl');

const router = express.Router();

router.get('/', authorize('order.view_queue', 'order.view_all'), async (req, res) => {
  res.render('app/queue', { title: 'คิวบาร์', q: await orderService.queue(req.user) });
});

module.exports = router;
