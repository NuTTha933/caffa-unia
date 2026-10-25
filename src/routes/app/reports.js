// /app/reports — ฟังก์ชัน report.sales
// ค่าเริ่มต้นยังไม่มี Permission ใดเชื่อมกับฟังก์ชันนี้ (ใช้ได้เฉพาะ Admin)
// ใช้สาธิต: Admin เพิ่ม Permission "report.view" → เชื่อมฟังก์ชัน → กำหนดให้ Role → ใช้งานได้ทันที
const express = require('express');
const reportService = require('../../services/reportService');
const { authorize } = require('../../middleware/acl');

const router = express.Router();

router.get('/', authorize('report.sales'), async (req, res) => {
  res.render('app/reports/sales', { title: 'รายงานยอดขาย', report: await reportService.sales() });
});

module.exports = router;
