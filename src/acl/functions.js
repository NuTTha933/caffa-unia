const FUNCTIONS = [
  ['menu.view',        'ดูเมนูและภาพเมนู', 'menu', 'GET /app/menu, GET /app/menu/:id, GET /api/menu, GET /api/menu/:id'],
  ['menu.create',      'เพิ่มเมนู', 'menu', 'GET|POST /app/menu/new, POST /api/menu'],
  ['menu.update',      'แก้ไขข้อมูลและราคาเมนู', 'menu', 'GET|POST /app/menu/:id/edit, PUT /api/menu/:id'],
  ['menu.image',       'อัปโหลด/เปลี่ยน/ลบภาพเมนู', 'menu', 'POST /app/menu/:id/image, POST /app/menu/:id/image/delete'],
  ['menu.toggle',      'เปิด/ปิดการขายเมนู (ของหมด)', 'menu', 'POST /app/menu/:id/availability, POST /api/menu/:id/availability'],
  ['menu.delete',      'ลบเมนู', 'menu', 'POST /app/menu/:id/delete, DELETE /api/menu/:id'],

  ['order.create',     'สั่งเครื่องดื่ม', 'order', 'GET|POST /app/orders/new, POST /api/orders'],
  ['order.cancel_own', 'ยกเลิกออเดอร์ของตนเอง (ก่อนร้านตรวจสลิป)', 'order', 'POST /app/orders/:id/cancel, POST /api/orders/:id/cancel'],
  ['order.view_own',   'ดูออเดอร์ของตนเอง', 'order', 'GET /app/orders, GET /app/orders/:id, GET /api/orders'],
  ['order.view_queue', 'ดูคิวบาร์ (ออเดอร์ที่ชำระแล้ว)', 'order', 'GET /app/queue, GET /app/orders/:id, GET /api/queue'],
  ['order.view_all',   'ดูออเดอร์ทั้งหมด', 'order', 'GET /app/orders, GET /app/orders/:id, GET /api/orders'],
  ['order.review',     'ตรวจสลิป: รับออเดอร์/ปฏิเสธ', 'order', 'POST /app/orders/:id/accept|reject, POST /api/orders/:id/accept|reject'],
  ['order.brew',       'ชงเครื่องดื่ม (รอชง → กำลังชง → พร้อมรับ)', 'order', 'POST /app/orders/:id/brew|ready, POST /api/orders/:id/brew|ready'],
  ['order.serve',      'ส่งมอบให้ลูกค้า (พร้อมรับ → รับแล้ว)', 'order', 'POST /app/orders/:id/complete, POST /api/orders/:id/complete'],
  ['order.delete',     'ลบออเดอร์', 'order', 'POST /app/orders/:id/delete, DELETE /api/orders/:id'],

  ['slip.upload',      'แนบสลิปโอนเงินในออเดอร์ของตนเอง', 'file', 'POST /app/orders/:id/slip'],
  ['slip.view',        'เปิดดู/ดาวน์โหลดสลิป (ตามขอบเขตออเดอร์ที่เห็นได้)', 'file', 'GET /app/files/:id, GET /app/files/:id/download, GET /api/files/:id'],
  ['slip.delete',      'ลบสลิปที่ตนเองอัปโหลด (ขณะรอตรวจ)', 'file', 'POST /app/files/:id/delete, DELETE /api/files/:id'],

  ['report.sales',     'รายงานยอดขาย', 'report', 'GET /app/reports, GET /api/reports/sales'],

  ['log.view',         'ดู Log งาน (หมวดออเดอร์/เมนู/ไฟล์)', 'log', 'GET /app/logs, GET /api/logs'],
  ['log.view_all',     'ดู Log ทุกหมวด + ส่งออก CSV', 'log', 'GET /app/logs, GET /app/logs/export.csv, GET /api/logs'],

  ['admin.users',       'จัดการผู้ใช้ (เพิ่ม/แก้ไข/ลบ/เปลี่ยน Role)', 'admin', '/admin/users/*, /api/admin/users/*'],
  ['admin.roles',       'จัดการบทบาท (Role)', 'admin', '/admin/roles/*, /api/admin/roles/*'],
  ['admin.permissions', 'จัดการ Permission และการเชื่อมกับฟังก์ชัน', 'admin', '/admin/permissions/*, /api/admin/permissions/*'],
  ['admin.acl',         'กำหนดสิทธิ์ ACL (Role × Permission) และดู Access Matrix', 'admin', '/admin/acl, /admin/access-matrix, /api/admin/acl'],
].map(([code, name, module, endpoints], i) => ({ code, name, module, endpoints, sortOrder: i + 1 }));

const ADMIN_AREA_FUNCTIONS = ['admin.users', 'admin.roles', 'admin.permissions', 'admin.acl'];

const CODES = new Set(FUNCTIONS.map((f) => f.code));

async function syncFunctions(db) {
  for (const f of FUNCTIONS) {
    await db.query(
      `INSERT INTO app_functions (code, name, module, endpoints, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, module = EXCLUDED.module,
             endpoints = EXCLUDED.endpoints, sort_order = EXCLUDED.sort_order`,
      [f.code, f.name, f.module, f.endpoints, f.sortOrder],
    );
  }
}

function assertKnown(code) {
  if (!CODES.has(code)) throw new Error(`authorize(): ไม่รู้จักฟังก์ชัน "${code}" — เพิ่มใน src/acl/functions.js ก่อน`);
}

module.exports = { FUNCTIONS, ADMIN_AREA_FUNCTIONS, syncFunctions, assertKnown };
