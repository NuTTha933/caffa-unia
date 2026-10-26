const express = require('express');
const reportService = require('../../services/reportService');
const { authorize } = require('../../middleware/acl');

const router = express.Router();

router.get('/', authorize('report.sales'), async (req, res) => {
  res.render('app/reports/sales', { title: 'รายงานยอดขาย', report: await reportService.sales() });
});

module.exports = router;
