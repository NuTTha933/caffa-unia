# Access Matrix — Kernel Coffee

ตารางนี้ตรงกับ ACL เริ่มต้นใน `database/seed.sql` และหน้า **/admin/access-matrix** ในระบบ
(หน้าในระบบคำนวณสดจากฐานข้อมูล ถ้า Admin เปลี่ยนสิทธิ์ผ่านเว็บ ให้ถือหน้านั้นเป็นข้อมูลล่าสุด)

## 1) Role × ทรัพยากร × การกระทำ

| ทรัพยากร | Admin (ผู้ดูแลระบบ) | Manager (ผู้จัดการร้าน) | Barista (บาริสต้า) | Customer (ลูกค้า) |
|---|---|---|---|---|
| **ออเดอร์** | ทุกสิทธิ์ (ดู สั่ง ตรวจสลิป ชง ส่งมอบ ลบ) | ดูทั้งหมด, ตรวจสลิป (รับ/ปฏิเสธ) ¹ | ดูคิวที่ชำระแล้ว ², เริ่มชง → พร้อมรับ → ส่งมอบ | สั่ง, ดูของตนเอง ³, ยกเลิกของตนเอง ⁴ |
| **เมนู** | ทุกสิทธิ์ | ดู, เพิ่ม, แก้ไขราคา/ข้อมูล, อัปโหลดภาพ, ปิดขาย, ลบ ⁵ | ดู, เปิด/ปิดการขาย (ของหมด) | ดู |
| **สลิปโอนเงิน** | ทุกสิทธิ์ (รวมลบสลิปของผู้อื่น) | เปิดดู/ดาวน์โหลดทุกออเดอร์ | ไม่มี ⁶ | แนบ ⁷, เปิดดู/ดาวน์โหลด, ลบ ⁸ (เฉพาะออเดอร์ของตน) |
| **ภาพเมนู** | ทุกสิทธิ์ | อัปโหลด/เปลี่ยน/ลบ, เปิดดู | เปิดดู | เปิดดู |
| **รายงานยอดขาย** | ดู | ไม่มี (ใช้สาธิตเพิ่ม `report.view` ผ่านเว็บ) | ไม่มี | ไม่มี |
| **Log** | ดูทุกหมวด + ส่งออก CSV | ดูตามกำหนด ⁹ | ไม่มี | ไม่มี |
| **ผู้ใช้ / Role / Permission / ACL** | ทุกสิทธิ์ (ส่วน /admin) | ไม่มี | ไม่มี | ไม่มี |

เงื่อนไขเฉพาะข้อมูล (ตรวจฝั่ง Server ใน `src/services/orderService.js` นอกเหนือจาก ACL)

1. ห้ามตรวจสลิปออเดอร์ของตนเอง และรับออเดอร์ได้เมื่อมีสลิปแนบแล้วเท่านั้น
2. คิวบาร์ = ออเดอร์สถานะ รอชง / กำลังชง / พร้อมรับ / รับแล้ว (ไม่เห็นออเดอร์ที่ยังไม่ชำระ ถูกปฏิเสธ หรือยกเลิก)
3. เห็นเฉพาะออเดอร์ที่ `customer_id` = ตนเอง (ทั้งหน้าเว็บ API และไฟล์สลิป)
4. ยกเลิกได้เฉพาะออเดอร์ของตนที่สถานะ "รอตรวจสลิป"
5. ลบได้เฉพาะเมนูที่ยังไม่เคยถูกสั่ง (เมนูที่มีประวัติยอดขายให้ปิดการขายแทน)
6. บาริสต้ามองเห็นออเดอร์ในคิวได้ แต่เปิดไฟล์สลิปไม่ได้ (ไม่มี `slip.read`)
7. แนบได้เฉพาะออเดอร์ของตนที่ยังรอตรวจ ชนิด JPG, PNG, PDF ไม่เกิน 3 MB (แนบใหม่จะแทนที่สลิปเดิม)
8. ลบได้เฉพาะสลิปที่ตนอัปโหลด และออเดอร์ยังรอตรวจ
9. เห็นเฉพาะหมวดออเดอร์ เมนู และไฟล์ (ไม่เห็นการเข้าสู่ระบบ การจัดการสิทธิ์ และการเข้าถึงที่ถูกปฏิเสธ) และส่งออก CSV ไม่ได้

## 2) Role × Permission (ACL เริ่มต้น)

✓ = กำหนดใน `role_permissions` · Admin ผ่านทุกสิทธิ์อัตโนมัติจาก `roles.is_admin`

| Permission | เปิดฟังก์ชัน | Admin | Manager | Barista | Customer |
|---|---|:-:|:-:|:-:|:-:|
| menu.read | menu.view | ✓ | ✓ | ✓ | ✓ |
| menu.create | menu.create | ✓ | ✓ | | |
| menu.update | menu.update, menu.image | ✓ | ✓ | | |
| menu.availability | menu.toggle | ✓ | ✓ | ✓ | |
| menu.delete | menu.delete | ✓ | ✓ | | |
| order.create | order.create, order.cancel_own | ✓ | | | ✓ |
| order.read_own | order.view_own | ✓ | | | ✓ |
| order.read_queue | order.view_queue | ✓ | | ✓ | |
| order.read_all | order.view_all | ✓ | ✓ | | |
| order.review | order.review | ✓ | ✓ | | |
| order.prepare | order.brew, order.serve | ✓ | | ✓ | |
| order.delete | order.delete | ✓ | | | |
| slip.upload | slip.upload | ✓ | | | ✓ |
| slip.read | slip.view | ✓ | ✓ | | ✓ |
| slip.delete | slip.delete | ✓ | | | ✓ |
| log.read | log.view | ✓ | ✓ | | |
| log.read_all | log.view_all | ✓ | | | |
| user.manage | admin.users | ✓ | | | |
| role.manage | admin.roles | ✓ | | | |
| permission.manage | admin.permissions | ✓ | | | |
| acl.manage | admin.acl | ✓ | | | |

ฟังก์ชัน `report.sales` (หน้า /app/reports และ /api/reports/sales) ยังไม่มี Permission ใดเชื่อมไว้ — ใช้สาธิตข้อ 6–7 ของการนำเสนอ

## 3) ฟังก์ชัน → Route ที่ตรวจสิทธิ์

| ฟังก์ชัน | หน้าเว็บ / API |
|---|---|
| menu.view | GET /app/menu, /app/menu/:id, /api/menu, /api/menu/:id |
| menu.create | GET/POST /app/menu/new, POST /api/menu |
| menu.update | GET/POST /app/menu/:id/edit, PUT /api/menu/:id |
| menu.image | POST /app/menu/:id/image, /app/menu/:id/image/delete |
| menu.toggle | POST /app/menu/:id/availability, /api/menu/:id/availability |
| menu.delete | POST /app/menu/:id/delete, DELETE /api/menu/:id |
| order.create | GET/POST /app/orders/new, POST /api/orders |
| order.cancel_own | POST /app/orders/:id/cancel, /api/orders/:id/cancel |
| order.view_own / view_queue / view_all | GET /app/orders, /app/orders/:id, /api/orders (+ /app/queue, /api/queue สำหรับคิว) |
| order.review | POST /app/orders/:id/accept, /reject (+ /api/…) |
| order.brew | POST /app/orders/:id/brew, /ready (+ /api/…) |
| order.serve | POST /app/orders/:id/complete (+ /api/…) |
| order.delete | POST /app/orders/:id/delete, DELETE /api/orders/:id |
| slip.upload | POST /app/orders/:id/slip |
| slip.view | GET /app/files/:id, /app/files/:id/download, /api/files/:id |
| slip.delete | POST /app/files/:id/delete, DELETE /api/files/:id |
| report.sales | GET /app/reports, /api/reports/sales |
| log.view / log.view_all | GET /app/logs, /api/logs (+ /app/logs/export.csv เฉพาะ view_all) |
| admin.users / roles / permissions / acl | /admin/…, /api/admin/… |
