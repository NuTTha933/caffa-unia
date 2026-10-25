// =====================================================================
//  Middleware : บันทึกการเข้าใช้งานหน้าเว็บ/API ของผู้ใช้ (ดูย้อนหลังได้ว่าใครเข้าส่วนไหน เมื่อไร)
//  - การเปลี่ยนแปลงข้อมูล (เพิ่ม/แก้ไข/ลบ/อนุมัติ) บันทึกละเอียดใน Service แต่ละตัว
//  - การเข้าถึงที่ถูกปฏิเสธ บันทึกใน errorHandler
// =====================================================================
const { audit } = require('../services/auditService');

const TRACKED = /^\/(app|admin|api)(\/|$)/;
const SKIP = /^\/(app|api)\/files\//; // การเปิดไฟล์บันทึกแยกเป็น file.view / file.download

function activityLog(req, res, next) {
  if (req.method !== 'GET') return next();
  const url = req.originalUrl.split('?')[0];
  if (!TRACKED.test(url) || SKIP.test(url)) return next();

  res.on('finish', () => {
    if (!req.user || res.statusCode >= 300) return;
    const isApi = url.startsWith('/api');
    const query = Object.keys(req.query || {}).length ? { query: req.query } : undefined;
    audit(req, {
      category: 'navigation',
      action: isApi ? 'api.read' : 'page.view',
      details: query,
    });
  });
  next();
}

module.exports = { activityLog };
