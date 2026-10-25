# Kernel Coffee — ระบบจัดการร้านกาแฟ
ลูกค้าสั่งเครื่องดื่มและแนบสลิป → ผู้จัดการตรวจสลิป → บาริสต้าชงและส่งมอบ
มีระบบยืนยันตัวตน (Session + bcrypt), กำหนดสิทธิ์แบบ **ACL** ที่จัดการผ่านหน้าเว็บ, ส่วน Admin แยกทาง Logical, Log ย้อนหลัง และอัปโหลดไฟล์ตามสิทธิ์

| ปัญหา | ผู้ใช้เป้าหมาย | ขอบเขต |
|---|---|---|
| ร้านรับออเดอร์ทางแชต ตรวจสลิปและติดตามคิวยาก ลูกค้าไม่รู้ว่าเครื่องดื่มเสร็จหรือยัง | ลูกค้า, ผู้จัดการร้าน, บาริสต้า, ผู้ดูแลระบบ | เมนู, สั่ง + แนบสลิป → ตรวจสลิป → ชง → พร้อมรับ → ส่งมอบ, รายงานยอดขาย, Log, จัดการผู้ใช้และสิทธิ์ |

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
# แก้ DB_PASSWORD และ SESSION_SECRET ในไฟล์ .env
npm run db:setup              # สร้างฐานข้อมูล + ตาราง + ข้อมูลตัวอย่าง (รันซ้ำได้ = รีเซ็ตข้อมูล)
npm start                     # หรือ npm run dev (รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด)
```

เปิด http://localhost:3000

รัน SQL ด้วยมือแทนสคริปต์ก็ได้ (แต่สคริปต์จะคัดลอกไฟล์ภาพ/สลิปตัวอย่างให้ด้วย):

```bash
createdb kernel_coffee
psql -d kernel_coffee -f database/schema.sql
psql -d kernel_coffee -f database/seed.sql
```

> ไฟล์ `.env` (มีรหัสผ่านจริง) ไม่ได้อยู่ในงานที่ส่ง ให้ใช้ `.env.example` เป็นต้นแบบ

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm test` | ทดสอบอัตโนมัติ 14 กรณีกับฐานข้อมูลทดสอบ `kernel_coffee_test` (ไม่แตะข้อมูลจริง) |
| `npm run er` | สร้างโครง ER จากฐานข้อมูลจริง → `docs/er-diagram.dot` / `.mmd` (ไว้ตรวจเทียบกับภาพ) |
| `npm run hash-password -- "รหัส"` | สร้าง bcrypt hash สำหรับใส่ใน SQL |

---

## 2. บัญชีทดสอบ

| Role | ชื่อผู้ใช้ | รหัสผ่าน | หน้าที่ |
|---|---|---|---|
| ผู้ดูแลระบบ (admin) | `admin` | `Admin@1234` | ทุกฟังก์ชัน รวมถึงที่เพิ่มภายหลัง จัดการผู้ใช้ Role Permission ACL |
| ผู้จัดการร้าน (manager) | `manager1` | `Manager@1234` | ตรวจสลิป รับ/ปฏิเสธออเดอร์ ดูออเดอร์ทั้งหมด จัดการเมนู ดู Log งาน |
| บาริสต้า (barista) | `barista1` | `Barista@1234` | ดูคิวบาร์ เริ่มชง → พร้อมรับ → ส่งมอบ ปิดเมนูที่ของหมด |
| ลูกค้า (customer) | `customer1` | `Customer@1234` | สั่งเครื่องดื่ม แนบสลิป ดู/ยกเลิกออเดอร์ของตน |
| ลูกค้า (customer) | `customer2` | `Customer@1234` | ใช้ทดสอบว่าเปิดออเดอร์/สลิปของคนอื่นไม่ได้ |
| ลูกค้า (customer) | `tester` | `Tester@1234` | ใช้สาธิตการกำหนด Role ใหม่ |

หน้าเข้าสู่ระบบมีปุ่ม "เลือก" กรอกบัญชีทดสอบให้ (ซ่อนอัตโนมัติเมื่อ `NODE_ENV=production`)

---

## 3. โครงสร้างโปรเจกต์

```
database/
  schema.sql              สร้างตาราง PK/FK/CHECK/INDEX ทั้งหมด
  seed.sql                ข้อมูลตัวอย่าง: 4 Role, Permission, ACL, ผู้ใช้, เมนู, ออเดอร์
  seed-files/             ภาพเมนูและสลิปตัวอย่าง (db:setup คัดลอกไปที่ storage/uploads)
docs/
  er-diagram.png/.svg     ER Diagram แสดง PK/FK (เส้นไม่ตัดกัน) + .dot / .mmd จากฐานข้อมูลจริง
  access-matrix.md        Access Matrix
  test-results.md         ผลการทดสอบ ปัญหาที่พบ ข้อจำกัด
  demo-files/             ไฟล์สาธิตการอัปโหลด (ถูกต้อง / ปลอมนามสกุล / เกินขนาด)
public/
  css/                    CSS แยกไฟล์ตามส่วน (ดูหัวข้อ 3.1)
  js/app.js               JavaScript ฝั่ง Browser (เมนูมือถือ, ยืนยันก่อนลบ, ตาราง ACL)
src/
  server.js               เริ่ม Server
  app.js                  ลำดับ Middleware และการแยกกลุ่ม Route
  config.js, db.js
  acl/functions.js        ทะเบียนฟังก์ชันที่ระบบรองรับ (จุดตรวจสิทธิ์)
  middleware/             auth, acl, security (CSRF/flash/จำกัดการล็อกอิน), activityLog, upload, errors
  services/               ตรรกะธุรกิจ + SQL (menu, order, file, acl, user, role, permission, audit, report)
  routes/
    auth.js               /login /logout
    app/                  /app/...        ส่วนผู้ใช้ทั่วไป (menu, orders, queue, files, reports, logs, profile)
    admin/                /admin/...      ส่วน Admin
    api/index.js          /api/...        REST API
    api/admin.js          /api/admin/...  REST API ส่วน Admin
  views/                  EJS (layouts, partials, app/, admin/, auth/, errors/)
storage/uploads/          ที่เก็บไฟล์อัปโหลด (นอก public — เปิดผ่าน Route ที่ตรวจสิทธิ์เท่านั้น)
tests/system.test.js      ทดสอบ End-to-End
```

### 3.1 ไฟล์ CSS (แก้หน้าไหน เปิดไฟล์ของหน้านั้น)

| ไฟล์ | เนื้อหา |
|---|---|
| `css/tokens.css` | ตัวแปรสี ฟอนต์ ขนาดตัวอักษร ระยะห่าง — เปลี่ยนสีทั้งเว็บที่ไฟล์นี้ไฟล์เดียว |
| `css/base.css` | พื้นฐาน: ตัวอักษร ลิงก์ focus |
| `css/layout.css` | หัวเว็บ เมนูด้านซ้าย ส่วนหัวของหน้า footer |
| `css/components/buttons.css` | ปุ่ม |
| `css/components/forms.css` | ช่องกรอก ตัวกรอง อัปโหลดไฟล์ |
| `css/components/feedback.css` | ข้อความแจ้งเตือน ป้ายสถานะ |
| `css/components/tables.css` | ตาราง (บนมือถือเรียงเป็นแถว) |
| `css/pages/login.css` | หน้าเข้าสู่ระบบ หน้าข้อผิดพลาด |
| `css/pages/dashboard.css` | หน้าหลัก ตัวเลขสรุป รายงาน |
| `css/pages/menu.css` | หน้าเมนู |
| `css/pages/orders.css` | หน้าสั่ง หน้ารายละเอียดออเดอร์ สลิป |
| `css/pages/queue.css` | หน้าคิวบาร์ |
| `css/pages/admin.css` | ตาราง ACL, Access Matrix, หน้า Log |
| `css/utilities.css` | class ช่วยเรื่องระยะห่าง (โหลดเป็นไฟล์สุดท้าย) |

ทุกไฟล์ถูกโหลดใน `src/views/partials/head.ejs`

---

## 4. สถาปัตยกรรมและลำดับ Middleware

```
Request
  │ 1 helmet ............ Security headers + Content-Security-Policy
  │ 2 express.static .... /css /js /img /vendor/fonts (ไม่รวม storage/uploads)
  │ 3 body parser ....... จำกัดขนาด 200 KB
  │ 4 express-session ... Session เก็บในตาราง user_sessions (PostgreSQL)
  │ 5 loadUser .......... โหลดผู้ใช้ + Role + ฟังก์ชันที่ใช้ได้จากฐานข้อมูล "ทุก Request"
  │ 6 csrfToken, flash
  │ 7 activityLog ....... บันทึกการเข้าใช้หน้า/API (page.view, api.read)
  │ 8 Routes
  │     /login /logout
  │     /app/*        → requireAuth → verifyCsrf → authorize('ฟังก์ชัน') → handler → service
  │     /admin/*      → requireAuth → adminAreaGate → verifyCsrf → authorize('admin.*') → handler
  │     /api/admin/*  → requireAuth → adminAreaGate → verifyCsrf → authorize('admin.*') → JSON
  │     /api/*        → requireAuth → verifyCsrf → authorize('ฟังก์ชัน') → JSON
  │     (อัปโหลด: authorize → uploadSingle (multer จำกัดขนาด) → ตรวจชนิดจากเนื้อไฟล์ → บันทึก)
  │ 9 notFound (404)
  ▼10 errorHandler ...... 403 ทุกกรณีถูกบันทึก Log (access_denied / file.access_denied), API ตอบ JSON
```

### ทำไมเลือก Session แทน Token

- Session ID อยู่ใน cookie `httpOnly` + `SameSite=Lax` JavaScript อ่านไม่ได้
- ข้อมูล Session อยู่ใน PostgreSQL → **ออกจากระบบ = ลบแถว Session ทันที** cookie เดิมใช้ต่อไม่ได้ (JWT ยกเลิกก่อนหมดอายุได้ยาก)
- สร้าง Session ID ใหม่ทุกครั้งที่เข้าสู่ระบบ (`session.regenerate`) กัน Session Fixation
- เก็บแค่ `userId` ใน Session แล้วอ่านสิทธิ์จากฐานข้อมูลทุก Request → **เปลี่ยน Role/ACL มีผลทันที ไม่ต้องเริ่ม Server ใหม่**

### รหัสผ่าน

- เก็บด้วย **bcrypt cost 12** (มี salt ในตัว hash) ตรวจด้วย `bcrypt.compare()`
- ไม่แสดง hash บนเว็บหรือ API, ไม่บันทึกรหัสผ่านลง Log (`sanitize()` ตัด key ที่เกี่ยวกับ password/token/session/csrf ออก)
- ใส่รหัสผิดได้ 8 ครั้งต่อ 10 นาที

---

## 5. การกำหนดสิทธิ์ (ACL)

```
users ──N:1── roles ──M:N── permissions ──M:N── app_functions ◄── authorize('...') ในโค้ด
              (role_permissions = ตาราง ACL)    (permission_functions)
```

- **Role** และ **Permission** เป็นข้อมูลในฐานข้อมูล Admin เพิ่ม/แก้ไข/ลบผ่านเว็บได้
- **ฟังก์ชันที่ระบบรองรับ** (`app_functions`) คือจุดตรวจสิทธิ์ในโค้ด เช่น `authorize('order.review')` ระบบลงทะเบียนให้อัตโนมัติตอนเริ่ม Server
- Admin **เชื่อม Permission กับฟังก์ชัน** ในหน้า Permission แล้ว **กำหนด Permission ให้ Role** ในหน้า ACL (ตาราง Role × Permission)
- Permission ที่ยังไม่เชื่อมกับฟังก์ชันจะ **ไม่เปิดสิทธิ์อะไร**
- Role ที่ `is_admin = true` ผ่านทุกฟังก์ชันอัตโนมัติ รวมถึงฟังก์ชันที่เพิ่มในโค้ดภายหลัง
- เงื่อนไขเจ้าของข้อมูลตรวจซ้ำใน Service เช่น ลูกค้าเห็นเฉพาะออเดอร์ของตน, ห้ามตรวจสลิปออเดอร์ของตนเอง, บาริสต้าเห็นเฉพาะออเดอร์ที่ชำระแล้ว
- ป้องกันลบ Role ที่ยังมีผู้ใช้ / Role หลัก และป้องกันการเปลี่ยนแปลงที่ทำให้ไม่มี Admin เหลือ

Access Matrix ฉบับเต็ม: `docs/access-matrix.md` และหน้า `/admin/access-matrix` (คำนวณสดจากฐานข้อมูล)

---

## 6. ฐานข้อมูล

ER Diagram: `docs/er-diagram.png` (แสดงเฉพาะ PK และ FK ของ 14 ตาราง, ความสัมพันธ์ 19 เส้น)

| ตาราง | หน้าที่ |
|---|---|
| `roles`, `permissions`, `app_functions` | บทบาท, รายการสิทธิ์, ฟังก์ชันที่ระบบรองรับ |
| `role_permissions` | ACL: Role ↔ Permission (PK คู่, FK CASCADE) |
| `permission_functions` | Permission ↔ ฟังก์ชัน |
| `users` | ผู้ใช้ (FK `role_id` ON DELETE RESTRICT = ลบ Role ที่มีผู้ใช้ไม่ได้) |
| `menu_categories`, `menu_items` | หมวดเมนู, เมนู (CHECK ราคา > 0, `is_available` = เปิด/ปิดขาย) |
| `orders` | ออเดอร์ (CHECK สถานะ, ผู้ตรวจสลิป, บาริสต้า, เวลาแต่ละขั้น) |
| `order_items` | รายการในออเดอร์ เก็บชื่อและราคา ณ เวลาสั่ง (`line_total` คำนวณอัตโนมัติ) |
| `order_status_history` | ประวัติการเปลี่ยนสถานะ |
| `files` | ไฟล์อัปโหลด: ชื่อเดิม/ชื่อจัดเก็บ/ชนิด/ขนาด/ผู้อัปโหลด/เวลา (CHECK ผูกกับเมนูหรือออเดอร์อย่างใดอย่างหนึ่ง) |
| `audit_logs` | Log ถาวร |
| `user_sessions` | Session store |

สถานะออเดอร์: `pending` (รอตรวจสลิป) → `accepted` (รอชง) → `brewing` → `ready` → `completed`
หรือ `pending` → `rejected` (สลิปไม่ผ่าน) / `cancelled` (ลูกค้ายกเลิก)

---

## 7. การอัปโหลดไฟล์

| ประเภท | ชนิดที่อนุญาต | ขนาดสูงสุด | สิทธิ์ |
|---|---|---|---|
| สลิปโอนเงิน | JPG, PNG, PDF | 3 MB | แนบ: `slip.upload` (ออเดอร์ของตนที่รอตรวจ) · เปิด: `slip.view` + มองเห็นออเดอร์ · ลบ: `slip.delete` + เป็นผู้อัปโหลด |
| ภาพเมนู | JPG, PNG, WEBP | 2 MB | อัปโหลด/ลบ: `menu.image` · เปิด: `menu.view` |

- multer รับไฟล์เข้าหน่วยความจำและ **ตัดทิ้งทันทีเมื่อเกินขนาด**
- ตรวจชนิดจาก **ไบต์แรกของไฟล์** (`%PDF-`, `FF D8 FF`, `89 PNG`, `RIFF....WEBP`) ไม่เชื่อนามสกุลหรือ Content-Type จาก Browser
- ชื่อจัดเก็บเป็น `UUID.นามสกุล` (ไม่ชนกัน ไม่มี path จากผู้ใช้) และตรวจว่า path อยู่ในโฟลเดอร์จัดเก็บ
- `storage/uploads` **ไม่ได้เปิดเป็น static** เปิดได้ผ่าน `/app/files/:id` และ `/api/files/:id` ที่ตรวจสิทธิ์ทุกครั้ง
- Log: `file.upload`, `file.upload_rejected`, `file.view`, `file.download`, `file.delete`, `file.access_denied`

ไฟล์สาธิตใน `docs/demo-files/`: `slip-ตัวอย่าง.png` / `.pdf` (ถูกต้อง), `fake-image.jpg` (ข้อความเปลี่ยนนามสกุล), `too-large-5mb.png` (เกินขนาด), `menu-cf04-cappuccino.jpg` (ภาพเมนู)

---

## 8. Log การใช้งาน

บันทึกลง `audit_logs` (ยังอยู่หลังเริ่ม Server ใหม่) ทุกแถวมี วันเวลา, ผู้กระทำ (หรือชื่อบัญชีที่พยายามเข้าสู่ระบบ), Role, หมวด, เหตุการณ์, ทรัพยากรและรหัสรายการ, ผลลัพธ์ (สำเร็จ/ล้มเหลว/ถูกปฏิเสธ), Method + Path, IP และรายละเอียด

| หมวด | เหตุการณ์ตัวอย่าง |
|---|---|
| auth | login_success, login_failed, login_blocked, logout |
| order | order.create, order.accept, order.reject, order.brew, order.ready, order.complete, order.cancel, order.delete |
| menu | menu.create, menu.update, menu.sold_out, menu.available, menu.delete |
| file | file.upload, file.upload_rejected, file.view, file.download, file.delete, file.access_denied |
| admin | user.create, user.update, user.role_change, role.*, permission.*, acl.grant, acl.revoke, log.export |
| access | access_denied, auth_required |
| navigation | page.view, api.read |

หน้า `/app/logs` กรองตามช่วงวันที่ ผู้ใช้ หมวด เหตุการณ์ ผลลัพธ์ และคำค้น พร้อมตัวกรองด่วน
สิทธิ์ดู: `log.view` เห็นเฉพาะหมวดออเดอร์/เมนู/ไฟล์, `log.view_all` เห็นทุกหมวด + ส่งออก CSV

---

## 9. REST API (ใช้ Session cookie เดียวกับหน้าเว็บ)

ไม่ได้เข้าสู่ระบบ → `401`, ไม่มีสิทธิ์ → `403` พร้อม `required_functions`
คำขอที่เปลี่ยนข้อมูล (POST/PUT/DELETE) ต้องส่ง `Content-Type: application/json` หรือ header `X-CSRF-Token`

| Method | Path | ฟังก์ชันที่ตรวจ |
|---|---|---|
| GET | /api/me | (เข้าสู่ระบบแล้ว) |
| GET / POST | /api/menu | menu.view / menu.create |
| GET / PUT / DELETE | /api/menu/:id | menu.view / menu.update / menu.delete |
| POST | /api/menu/:id/availability | menu.toggle |
| GET / POST | /api/orders | order.view_* / order.create |
| GET | /api/orders/:id | order.view_* + เจ้าของข้อมูล |
| GET | /api/queue | order.view_queue |
| POST | /api/orders/:id/accept, reject, brew, ready, complete, cancel | order.review / brew / serve / cancel_own |
| DELETE | /api/orders/:id | order.delete |
| GET / DELETE | /api/files/:id | slip.view, menu.view / slip.delete |
| GET | /api/reports/sales | report.sales |
| GET | /api/logs | log.view / log.view_all |
| GET / POST / PUT / DELETE | /api/admin/users, roles, permissions | admin.users / roles / permissions |
| GET / PUT | /api/admin/acl, GET /api/admin/access-matrix | admin.acl |

---

## 10. ลำดับการสาธิต (12 นาที)

ใช้ 2 หน้าต่างเบราว์เซอร์ (หน้าต่างปกติ + Incognito) เพื่อแสดง Admin กับผู้ใช้ที่ถูกเปลี่ยนสิทธิ์ไปพร้อมกัน
ก่อนนำเสนอรัน `npm run db:setup` เพื่อเริ่มจากข้อมูลตัวอย่างที่สะอาด

1. **กระบวนการหลัก** — `customer1` สั่งเครื่องดื่ม → แนบ `docs/demo-files/slip-ตัวอย่าง.png` → `manager1` เปิดออเดอร์ ดูสลิป กด "รับออเดอร์" → `barista1` ในคิวบาร์กด เริ่มชง → ชงเสร็จ → ส่งมอบแล้ว → `customer1` ดูเส้นทางสถานะในหน้าออเดอร์
2. **ความต่างของ 4 Role** — เข้าสู่ระบบทีละบัญชี ดูเมนูด้านซ้าย หน้าหลัก และกล่อง "สิทธิ์ของบัญชีนี้"
3. **Admin เข้าถึงทุกฟังก์ชัน** — `admin` เข้า /admin จัดการผู้ใช้ Role Permission ACL และดู Access Matrix
4. **ผู้ไม่มีสิทธิ์ถูกปฏิเสธ** — `customer1` พิมพ์ `/admin/users` → หน้า 403, เปิด `/api/admin/users` → JSON 403, เปิดออเดอร์ของ customer2 `/app/orders/4` → 403
5. **เพิ่ม Role ใหม่** — Admin ไป บทบาท → เพิ่ม Role `accountant` (ฝ่ายบัญชี) → หน้า ผู้ใช้ → แก้ไข `tester` เปลี่ยน Role เป็นฝ่ายบัญชี
6. **เพิ่ม Permission และเชื่อมฟังก์ชัน** — Admin ไป Permission → เพิ่ม `report.view` ติ๊กฟังก์ชัน "รายงานยอดขาย (report.sales)" → หน้า ACL ติ๊ก ฝ่ายบัญชี × report.view → บันทึก → `tester` รีเฟรช เมนู "รายงานยอดขาย" ปรากฏ เปิด `/app/reports` และ `/api/reports/sales` ได้
7. **ยกเลิก Permission** — Admin เอาเครื่องหมายช่องเดิมออก → บันทึก → `tester` รีเฟรช `/app/reports` และ `/api/reports/sales` ได้ 403 ทันที (ไม่เริ่ม Server ใหม่)
8. **อัปโหลดไฟล์** — `customer1` แนบ `fake-image.jpg` และ `too-large-5mb.png` → ถูกปฏิเสธพร้อมข้อความ, แนบสลิปถูกต้องแล้วเปิดดู/ดาวน์โหลด, `customer2` หรือ `barista1` เปิด URL สลิปนั้น → 403, `manager1` อัปโหลด `menu-cf04-cappuccino.jpg` เป็นภาพเมนูคาปูชิโน่
9. **Log** — Admin ไป Log การใช้งาน ใช้ตัวกรองด่วน "การเพิ่ม Role", "การเปลี่ยนสิทธิ์ ACL", "การอัปโหลดไฟล์", "การเข้าถึงที่ถูกปฏิเสธ" และกรองตามผู้ใช้ `tester` / ช่วงวันที่

---

## 11. ความปลอดภัยเพิ่มเติม

- CSRF token ในทุกฟอร์มที่เปลี่ยนข้อมูล (ฟอร์มอัปโหลดส่ง token ทาง query string เพราะตรวจก่อนอ่านไฟล์), cookie `SameSite=Lax`
- Content-Security-Policy ไม่อนุญาต inline script / สคริปต์จากภายนอก (ฟอนต์และไฟล์ทั้งหมดเสิร์ฟจาก Server เอง)
- SQL ใช้ parameterized query ทั้งหมด, EJS escape ข้อมูลผู้ใช้ทุกจุด (`<%= %>`)
- ราคาออเดอร์คำนวณจากตารางเมนูฝั่ง Server เสมอ ไม่เชื่อค่าที่ Browser ส่งมา
- ป้องกัน open redirect ในพารามิเตอร์ `next` ของหน้าเข้าสู่ระบบ, ส่งออก CSV ป้องกัน formula injection
