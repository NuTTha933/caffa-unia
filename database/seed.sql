-- =====================================================================
--  ข้อมูลตัวอย่าง (Seed Data) — รันหลัง schema.sql
--  บัญชีทดสอบ (รหัสผ่านเก็บเป็น bcrypt hash cost 12 เท่านั้น)
--    admin     / Admin@1234     ผู้ดูแลระบบ
--    manager1  / Manager@1234   ผู้จัดการร้าน (ตรวจสลิป จัดการเมนู)
--    barista1  / Barista@1234   บาริสต้า (คิวบาร์)
--    customer1 / Customer@1234  ลูกค้า
--    customer2 / Customer@1234  ลูกค้า (ไว้ทดสอบสิทธิ์เจ้าของข้อมูล)
--    tester    / Tester@1234    ลูกค้า (ไว้สาธิตการกำหนด Role ใหม่)
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Roles (4 บทบาทเริ่มต้น)
-- ---------------------------------------------------------------------
INSERT INTO roles (code, name, description, is_admin, is_system) VALUES
 ('admin',    'ผู้ดูแลระบบ',   'ใช้งานได้ทุกฟังก์ชัน รวมถึงฟังก์ชันที่เพิ่มภายหลัง จัดการผู้ใช้ บทบาท และสิทธิ์', TRUE,  TRUE),
 ('manager',  'ผู้จัดการร้าน', 'ตรวจสลิปและรับ/ปฏิเสธออเดอร์ ดูออเดอร์ทั้งหมด จัดการเมนูและราคา ดู Log งาน', FALSE, TRUE),
 ('barista',  'บาริสต้า',      'ดูคิวบาร์ ชงและส่งมอบเครื่องดื่ม ปิดเมนูที่ของหมด',                        FALSE, TRUE),
 ('customer', 'ลูกค้า',        'สั่งเครื่องดื่ม แนบสลิป ติดตามสถานะ และยกเลิกออเดอร์ของตนเอง',              FALSE, TRUE);

-- ---------------------------------------------------------------------
-- ฟังก์ชันที่ระบบรองรับ (ตรงกับ src/acl/functions.js — ระบบ sync ให้อัตโนมัติตอนเริ่ม Server)
-- ---------------------------------------------------------------------
INSERT INTO app_functions (code, name, module, endpoints, sort_order) VALUES
 ('menu.view',         'ดูเมนูและภาพเมนู',                                'menu',   'GET /app/menu, GET /app/menu/:id, GET /api/menu, GET /api/menu/:id', 1),
 ('menu.create',       'เพิ่มเมนู',                                        'menu',   'GET|POST /app/menu/new, POST /api/menu', 2),
 ('menu.update',       'แก้ไขข้อมูลและราคาเมนู',                           'menu',   'GET|POST /app/menu/:id/edit, PUT /api/menu/:id', 3),
 ('menu.image',        'อัปโหลด/เปลี่ยน/ลบภาพเมนู',                       'menu',   'POST /app/menu/:id/image, POST /app/menu/:id/image/delete', 4),
 ('menu.toggle',       'เปิด/ปิดการขายเมนู (ของหมด)',                      'menu',   'POST /app/menu/:id/availability, POST /api/menu/:id/availability', 5),
 ('menu.delete',       'ลบเมนู',                                           'menu',   'POST /app/menu/:id/delete, DELETE /api/menu/:id', 6),
 ('order.create',      'สั่งเครื่องดื่ม',                                   'order',  'GET|POST /app/orders/new, POST /api/orders', 7),
 ('order.cancel_own',  'ยกเลิกออเดอร์ของตนเอง (ก่อนร้านตรวจสลิป)',          'order',  'POST /app/orders/:id/cancel, POST /api/orders/:id/cancel', 8),
 ('order.view_own',    'ดูออเดอร์ของตนเอง',                                'order',  'GET /app/orders, GET /app/orders/:id, GET /api/orders', 9),
 ('order.view_queue',  'ดูคิวบาร์ (ออเดอร์ที่ชำระแล้ว)',                    'order',  'GET /app/queue, GET /app/orders/:id, GET /api/queue', 10),
 ('order.view_all',    'ดูออเดอร์ทั้งหมด',                                 'order',  'GET /app/orders, GET /app/orders/:id, GET /api/orders', 11),
 ('order.review',      'ตรวจสลิป: รับออเดอร์/ปฏิเสธ',                      'order',  'POST /app/orders/:id/accept|reject, POST /api/orders/:id/accept|reject', 12),
 ('order.brew',        'ชงเครื่องดื่ม (รอชง → กำลังชง → พร้อมรับ)',          'order',  'POST /app/orders/:id/brew|ready, POST /api/orders/:id/brew|ready', 13),
 ('order.serve',       'ส่งมอบให้ลูกค้า (พร้อมรับ → รับแล้ว)',               'order',  'POST /app/orders/:id/complete, POST /api/orders/:id/complete', 14),
 ('order.delete',      'ลบออเดอร์',                                        'order',  'POST /app/orders/:id/delete, DELETE /api/orders/:id', 15),
 ('slip.upload',       'แนบสลิปโอนเงินในออเดอร์ของตนเอง',                  'file',   'POST /app/orders/:id/slip', 16),
 ('slip.view',         'เปิดดู/ดาวน์โหลดสลิป (ตามขอบเขตออเดอร์ที่เห็นได้)', 'file',   'GET /app/files/:id, GET /app/files/:id/download, GET /api/files/:id', 17),
 ('slip.delete',       'ลบสลิปที่ตนเองอัปโหลด (ขณะรอตรวจ)',                 'file',   'POST /app/files/:id/delete, DELETE /api/files/:id', 18),
 ('report.sales',      'รายงานยอดขาย',                                     'report', 'GET /app/reports, GET /api/reports/sales', 19),
 ('log.view',          'ดู Log งาน (หมวดออเดอร์/เมนู/ไฟล์)',                'log',    'GET /app/logs, GET /api/logs', 20),
 ('log.view_all',      'ดู Log ทุกหมวด + ส่งออก CSV',                      'log',    'GET /app/logs, GET /app/logs/export.csv, GET /api/logs', 21),
 ('admin.users',       'จัดการผู้ใช้ (เพิ่ม/แก้ไข/ลบ/เปลี่ยน Role)',        'admin',  '/admin/users/*, /api/admin/users/*', 22),
 ('admin.roles',       'จัดการบทบาท (Role)',                               'admin',  '/admin/roles/*, /api/admin/roles/*', 23),
 ('admin.permissions', 'จัดการ Permission และการเชื่อมกับฟังก์ชัน',          'admin',  '/admin/permissions/*, /api/admin/permissions/*', 24),
 ('admin.acl',         'กำหนดสิทธิ์ ACL (Role × Permission) และดู Access Matrix', 'admin', '/admin/acl, /admin/access-matrix, /api/admin/acl', 25);

-- ---------------------------------------------------------------------
-- Permissions (report.view ไม่ได้ใส่ไว้ — ใช้สาธิตการเพิ่ม Permission ผ่านเว็บ)
-- ---------------------------------------------------------------------
INSERT INTO permissions (code, name, description) VALUES
 ('menu.read',          'ดูเมนู',                 'ดูเมนู ราคา และภาพเมนู'),
 ('menu.create',        'เพิ่มเมนู',              'เพิ่มเมนูใหม่เข้าระบบ'),
 ('menu.update',        'แก้ไขเมนู',              'แก้ไขข้อมูล ราคา และภาพเมนู'),
 ('menu.availability',  'เปิด/ปิดการขายเมนู',      'ตั้งเมนูเป็น "หมด" หรือกลับมาขาย'),
 ('menu.delete',        'ลบเมนู',                 'ลบเมนูที่ยังไม่เคยถูกสั่ง'),
 ('order.create',       'สั่งเครื่องดื่ม',          'สั่งเครื่องดื่มและยกเลิกออเดอร์ของตนเองก่อนร้านตรวจสลิป'),
 ('order.read_own',     'ดูออเดอร์ของตนเอง',      'ดูเฉพาะออเดอร์ที่ตนเองสั่ง'),
 ('order.read_queue',   'ดูคิวบาร์',              'ดูออเดอร์ที่ชำระแล้ว (รอชง/กำลังชง/พร้อมรับ/รับแล้ว)'),
 ('order.read_all',     'ดูออเดอร์ทั้งหมด',       'ดูออเดอร์ของทุกคนทุกสถานะ'),
 ('order.review',       'ตรวจสลิป',               'รับออเดอร์เมื่อสลิปถูกต้อง หรือปฏิเสธพร้อมเหตุผล'),
 ('order.prepare',      'ชงและส่งมอบ',            'เริ่มชง ชงเสร็จ และส่งมอบเครื่องดื่มให้ลูกค้า'),
 ('order.delete',       'ลบออเดอร์',              'ลบออเดอร์ออกจากระบบ'),
 ('slip.upload',        'แนบสลิป',                'แนบสลิปโอนเงินในออเดอร์ของตนเอง'),
 ('slip.read',          'ดูสลิป',                 'เปิดดู/ดาวน์โหลดสลิปของออเดอร์ที่ตนเองเข้าถึงได้'),
 ('slip.delete',        'ลบสลิป',                 'ลบสลิปที่ตนเองอัปโหลดขณะรอร้านตรวจ'),
 ('log.read',           'ดู Log งาน',             'ดู Log หมวดออเดอร์ เมนู และไฟล์'),
 ('log.read_all',       'ดู Log ทั้งหมด',         'ดู Log ทุกหมวดและส่งออก CSV'),
 ('user.manage',        'จัดการผู้ใช้',           'เพิ่ม แก้ไข ลบผู้ใช้ และกำหนด Role'),
 ('role.manage',        'จัดการบทบาท',           'เพิ่ม แก้ไข ลบ Role'),
 ('permission.manage',  'จัดการ Permission',     'เพิ่ม แก้ไข ลบ Permission และเชื่อมกับฟังก์ชัน'),
 ('acl.manage',         'จัดการ ACL',            'กำหนด/ยกเลิก Permission ให้ Role');

-- Permission → ฟังก์ชันที่เปิดให้ใช้
INSERT INTO permission_functions (permission_id, function_id)
SELECT p.id, f.id
FROM (VALUES
  ('menu.read',         'menu.view'),
  ('menu.create',       'menu.create'),
  ('menu.update',       'menu.update'),
  ('menu.update',       'menu.image'),
  ('menu.availability', 'menu.toggle'),
  ('menu.delete',       'menu.delete'),
  ('order.create',      'order.create'),
  ('order.create',      'order.cancel_own'),
  ('order.read_own',    'order.view_own'),
  ('order.read_queue',  'order.view_queue'),
  ('order.read_all',    'order.view_all'),
  ('order.review',      'order.review'),
  ('order.prepare',     'order.brew'),
  ('order.prepare',     'order.serve'),
  ('order.delete',      'order.delete'),
  ('slip.upload',       'slip.upload'),
  ('slip.read',         'slip.view'),
  ('slip.delete',       'slip.delete'),
  ('log.read',          'log.view'),
  ('log.read_all',      'log.view_all'),
  ('user.manage',       'admin.users'),
  ('role.manage',       'admin.roles'),
  ('permission.manage', 'admin.permissions'),
  ('acl.manage',        'admin.acl')
) AS m(perm_code, fn_code)
JOIN permissions   p ON p.code = m.perm_code
JOIN app_functions f ON f.code = m.fn_code;

-- ---------------------------------------------------------------------
-- ACL เริ่มต้น : Role × Permission
-- ---------------------------------------------------------------------
-- Admin ได้ทุก Permission (และระบบให้ผ่านอัตโนมัติจาก is_admin)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('manager',  'menu.read'),
  ('manager',  'menu.create'),
  ('manager',  'menu.update'),
  ('manager',  'menu.availability'),
  ('manager',  'menu.delete'),
  ('manager',  'order.read_all'),
  ('manager',  'order.review'),
  ('manager',  'slip.read'),
  ('manager',  'log.read'),

  ('barista',  'menu.read'),
  ('barista',  'menu.availability'),
  ('barista',  'order.read_queue'),
  ('barista',  'order.prepare'),

  ('customer', 'menu.read'),
  ('customer', 'order.create'),
  ('customer', 'order.read_own'),
  ('customer', 'slip.upload'),
  ('customer', 'slip.read'),
  ('customer', 'slip.delete')
) AS g(role_code, perm_code)
JOIN roles r       ON r.code = g.role_code
JOIN permissions p ON p.code = g.perm_code;

-- ---------------------------------------------------------------------
-- ผู้ใช้ทดสอบ
-- ---------------------------------------------------------------------
INSERT INTO users (username, full_name, email, phone, password_hash, role_id)
SELECT u.username, u.full_name, u.email, u.phone, u.hash, r.id
FROM (VALUES
  ('admin',     'สมชาย ดูแลระบบ',    'admin@kernel.example',     '081-000-0001', 'admin',    '$2b$12$l6DgKhaXhI7iZWEcSgfz7uXDzNaz4vQ9/nQLuFdvcK82pY61gb82O'),
  ('manager1',  'พิมพ์ชนก ศรีสุข',    'manager1@kernel.example',  '081-000-0002', 'manager',  '$2b$12$SzoBsC/cWkW3s/kqBbORJ.Ll0uBDii0fGOsidyWg8YuSbcZQw2A3G'),
  ('barista1',  'กิตติ คั่วกลาง',     'barista1@kernel.example',  '081-000-0003', 'barista',  '$2b$12$CLZj5t5z42OFr3wfpyWP/e2KVsaURynk1KVF5y3sgg9yYoMNnTHGq'),
  ('customer1', 'กานดา ใจดี',        'customer1@kernel.example', '089-111-2222', 'customer', '$2b$12$FMDMvoL1yNcW.g3dnaGA9OHY0GPrxVWbelonfVuCInyO4oFyxpe/.'),
  ('customer2', 'ธนา ขยันเรียน',     'customer2@kernel.example', '089-333-4444', 'customer', '$2b$12$FMDMvoL1yNcW.g3dnaGA9OHY0GPrxVWbelonfVuCInyO4oFyxpe/.'),
  ('tester',    'ทดสอบ ระบบสิทธิ์',   'tester@kernel.example',    NULL,           'customer', '$2b$12$ePpb7VLLp6M7HYj2.ANlYuhqaFROMsHrq9o9DRmJU1s2UpE5IMQXy')
) AS u(username, full_name, email, phone, role_code, hash)
JOIN roles r ON r.code = u.role_code;

-- ---------------------------------------------------------------------
-- หมวดเมนู + เมนู
-- ---------------------------------------------------------------------
INSERT INTO menu_categories (name, sort_order) VALUES
 ('กาแฟ',           1),
 ('ชาและมัทฉะ',      2),
 ('นมและช็อกโกแลต',   3),
 ('เบเกอรี่',         4);

INSERT INTO menu_items (code, name, category_id, description, price, is_available, created_by)
SELECT m.code, m.name, c.id, m.description, m.price, m.available, (SELECT id FROM users WHERE username = 'manager1')
FROM (VALUES
  ('CF-01', 'เอสเปรสโซ่ร้อน',             'กาแฟ',            'ช็อตคู่ เมล็ดคั่วกลาง เบลนด์ประจำร้าน',           55, TRUE),
  ('CF-02', 'อเมริกาโน่เย็น',             'กาแฟ',            'เอสเปรสโซ่ช็อตคู่กับน้ำเย็น ไม่ใส่นม',            65, TRUE),
  ('CF-03', 'ลาเต้เย็น',                  'กาแฟ',            'เอสเปรสโซ่กับนมสด รสนุ่ม',                      75, TRUE),
  ('CF-04', 'คาปูชิโน่ร้อน',              'กาแฟ',            'ฟองนมหนา โรยผงโกโก้บาง ๆ',                     70, TRUE),
  ('CF-05', 'มอคค่าเย็น',                 'กาแฟ',            'เอสเปรสโซ่ ช็อกโกแลต และนมสด',                  80, TRUE),
  ('CF-06', 'ดริปดอยช้าง คั่วอ่อน',        'กาแฟ',            'ดริปทีละแก้ว กลิ่นผลไม้ ใช้เวลาชงราว 4 นาที',      90, TRUE),
  ('CF-07', 'Kernel Panic โทนิก',         'กาแฟ',            'เอสเปรสโซ่บนโทนิกและผิวส้ม เมนูประจำร้าน',        95, TRUE),
  ('TE-01', 'ชาไทยเย็น',                  'ชาและมัทฉะ',       'ชาไทยต้มเอง นมข้นจืด',                          55, TRUE),
  ('TE-02', 'มัทฉะลาเต้เย็น',             'ชาและมัทฉะ',       'มัทฉะเกรดพิธีชงกับนมสด',                        85, TRUE),
  ('TE-03', 'ชามะนาว',                    'ชาและมัทฉะ',       'ชาดำกับมะนาวคั้นสด',                            50, FALSE),
  ('MK-01', 'โกโก้เย็น',                  'นมและช็อกโกแลต',   'โกโก้ดัตช์เข้มข้น',                             65, TRUE),
  ('MK-02', 'นมสดคาราเมล',               'นมและช็อกโกแลต',   'นมสดกับซอสคาราเมลเคี่ยวเอง',                    60, TRUE),
  ('BK-01', 'ครัวซองต์เนยสด',             'เบเกอรี่',          'อบใหม่ทุกเช้า',                                 65, TRUE),
  ('BK-02', 'บานอฟฟี่ (ชิ้น)',            'เบเกอรี่',          'กล้วยหอม คาราเมล วิปครีม',                       85, TRUE)
) AS m(code, name, category, description, price, available)
JOIN menu_categories c ON c.name = m.category;

-- ---------------------------------------------------------------------
-- ออเดอร์ตัวอย่าง (เวลาอิงจากปัจจุบัน เพื่อให้สาธิตได้ทุกวัน)
-- ---------------------------------------------------------------------
-- ตัวช่วยชั่วคราว: สร้างออเดอร์ + รายการ + ประวัติสถานะ ในคำสั่งเดียว
CREATE TEMP TABLE seed_orders (
  seq INT, customer TEXT, status TEXT, ago INTERVAL, note TEXT, review_note TEXT, items TEXT[]
) ON COMMIT DROP;

INSERT INTO seed_orders VALUES
 -- ออเดอร์สำหรับสาธิตกระบวนการวันนี้
 (1, 'customer1', 'completed', '1 day 3 hours',  'มารับตอนบ่าย',            NULL, ARRAY['CF-03:1', 'BK-01:1']),
 (2, 'customer2', 'completed', '2 days 1 hour',  NULL,                     NULL, ARRAY['CF-02:2']),
 (3, 'customer1', 'pending',   '12 minutes',     'ขอแก้วกระดาษ',            NULL, ARRAY['TE-02:1', 'CF-01:1']),
 (4, 'customer2', 'pending',   '6 minutes',      NULL,                     NULL, ARRAY['MK-01:2']),
 (5, 'customer2', 'accepted',  '25 minutes',     NULL,                     NULL, ARRAY['CF-05:1']),
 (6, 'customer1', 'brewing',   '35 minutes',     NULL,                     NULL, ARRAY['CF-06:1']),
 (7, 'customer2', 'ready',     '50 minutes',     'ไม่ใส่หลอด',              NULL, ARRAY['CF-07:1', 'BK-02:1']),
 (8, 'customer1', 'rejected',  '3 hours',        NULL, 'ยอดโอนในสลิป 55 บาท ไม่ตรงกับยอดออเดอร์ 130 บาท', ARRAY['CF-04:1', 'MK-02:1']),
 (9, 'customer2', 'cancelled', '5 hours',        NULL,                     NULL, ARRAY['TE-01:1']),
 -- ยอดขายย้อนหลัง 6 วัน (สำหรับรายงานยอดขาย)
 (10, 'customer1', 'completed', '3 days 2 hours', NULL, NULL, ARRAY['CF-03:2', 'BK-01:2']),
 (11, 'customer2', 'completed', '3 days 5 hours', NULL, NULL, ARRAY['TE-01:1']),
 (12, 'tester',    'completed', '4 days 1 hour',  NULL, NULL, ARRAY['CF-07:1']),
 (13, 'customer1', 'completed', '4 days 6 hours', NULL, NULL, ARRAY['CF-02:1', 'MK-01:1']),
 (14, 'customer2', 'completed', '5 days 2 hours', NULL, NULL, ARRAY['CF-03:3']),
 (15, 'customer1', 'completed', '5 days 4 hours', NULL, NULL, ARRAY['TE-02:1', 'BK-02:1']),
 (16, 'customer2', 'completed', '6 days 3 hours', NULL, NULL, ARRAY['CF-05:2']),
 (17, 'tester',    'completed', '6 days 7 hours', NULL, NULL, ARRAY['CF-01:1', 'CF-06:1']);

DO $$
DECLARE
  s RECORD; it TEXT; parts TEXT[]; m RECORD; oid INT; t0 TIMESTAMPTZ; total NUMERIC := 0;
  mgr INT := (SELECT id FROM users WHERE username = 'manager1');
  bar INT := (SELECT id FROM users WHERE username = 'barista1');
  rank INT;
BEGIN
  FOR s IN SELECT * FROM seed_orders ORDER BY seq LOOP
    t0 := now() - s.ago;
    total := 0;
    FOREACH it IN ARRAY s.items LOOP
      parts := string_to_array(it, ':');
      SELECT price INTO m FROM menu_items WHERE code = parts[1];
      total := total + m.price * parts[2]::INT;
    END LOOP;

    rank := CASE s.status WHEN 'pending' THEN 0 WHEN 'cancelled' THEN 0 WHEN 'rejected' THEN 1
                          WHEN 'accepted' THEN 1 WHEN 'brewing' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END;

    INSERT INTO orders (customer_id, status, total_amount, note, reviewed_by, reviewed_at, review_note,
                        barista_id, brewing_at, ready_at, completed_at, created_at)
    VALUES ((SELECT id FROM users WHERE username = s.customer), s.status, total, s.note,
            CASE WHEN rank >= 1 THEN mgr END,
            CASE WHEN rank >= 1 THEN t0 + interval '4 minutes' END,
            s.review_note,
            CASE WHEN rank >= 2 THEN bar END,
            CASE WHEN rank >= 2 THEN t0 + interval '9 minutes' END,
            CASE WHEN rank >= 3 THEN t0 + interval '15 minutes' END,
            CASE WHEN rank >= 4 THEN t0 + interval '21 minutes' END,
            t0)
    RETURNING id INTO oid;

    FOREACH it IN ARRAY s.items LOOP
      parts := string_to_array(it, ':');
      INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity)
      SELECT oid, mi.id, mi.name, mi.price, parts[2]::INT
        FROM menu_items mi WHERE mi.code = parts[1];
    END LOOP;

    -- ประวัติสถานะ
    INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
    VALUES (oid, NULL, 'pending', (SELECT id FROM users WHERE username = s.customer), 'สั่งเครื่องดื่ม', t0);
    IF s.status = 'cancelled' THEN
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
      VALUES (oid, 'pending', 'cancelled', (SELECT id FROM users WHERE username = s.customer), 'ลูกค้ายกเลิกออเดอร์', t0 + interval '3 minutes');
    ELSIF s.status = 'rejected' THEN
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
      VALUES (oid, 'pending', 'rejected', mgr, s.review_note, t0 + interval '4 minutes');
    ELSIF rank >= 1 THEN
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
      VALUES (oid, 'pending', 'accepted', mgr, 'ตรวจสลิปแล้ว ยอดตรง', t0 + interval '4 minutes');
      IF rank >= 2 THEN
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
        VALUES (oid, 'accepted', 'brewing', bar, 'เริ่มชง', t0 + interval '9 minutes');
      END IF;
      IF rank >= 3 THEN
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
        VALUES (oid, 'brewing', 'ready', bar, 'ชงเสร็จ รอลูกค้ารับ', t0 + interval '15 minutes');
      END IF;
      IF rank >= 4 THEN
        INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note, changed_at)
        VALUES (oid, 'ready', 'completed', bar, 'ส่งมอบแล้ว', t0 + interval '21 minutes');
      END IF;
    END IF;

    -- สลิปตัวอย่าง (ทุกออเดอร์ยกเว้นที่ยกเลิก) — ตัวไฟล์ถูกคัดลอกโดย scripts/db-setup.js
    IF s.status <> 'cancelled' THEN
      INSERT INTO files (kind, original_name, stored_name, mime_type, size_bytes, order_id, uploaded_by, uploaded_at)
      VALUES ('payment_slip', format('slip-K%s.png', lpad(oid::TEXT, 4, '0')),
              gen_random_uuid()::TEXT || '.png', 'image/png', 1, oid,
              (SELECT id FROM users WHERE username = s.customer), t0 + interval '1 minute');
    END IF;
  END LOOP;
END $$;

-- ภาพเมนูตัวอย่าง (ตัวไฟล์อยู่ใน database/seed-files/menu/<code>.jpg)
INSERT INTO files (kind, original_name, stored_name, mime_type, size_bytes, menu_item_id, uploaded_by)
SELECT 'menu_image', lower(mi.code) || '.jpg', gen_random_uuid()::TEXT || '.jpg', 'image/jpeg', 1, mi.id,
       (SELECT id FROM users WHERE username = 'manager1')
  FROM menu_items mi
 WHERE mi.code IN ('CF-02', 'CF-03', 'CF-05', 'CF-07', 'TE-02', 'MK-01');

COMMIT;
