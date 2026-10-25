-- =====================================================================
--  Kernel Coffee — ระบบจัดการร้านกาแฟ (สั่งเครื่องดื่ม + แนบสลิป + คิวบาร์)
--  Database Schema · PostgreSQL 13+ (ใช้ gen_random_uuid() ที่มีในตัวตั้งแต่ PG13)
--  คำเตือน: ไฟล์นี้ DROP ตารางเดิมทั้งหมดก่อนสร้างใหม่ (ใช้สำหรับติดตั้ง/รีเซ็ต)
-- =====================================================================

DROP TABLE IF EXISTS audit_logs            CASCADE;
DROP TABLE IF EXISTS files                 CASCADE;
DROP TABLE IF EXISTS order_status_history  CASCADE;
DROP TABLE IF EXISTS order_items           CASCADE;
DROP TABLE IF EXISTS orders                CASCADE;
DROP TABLE IF EXISTS menu_items            CASCADE;
DROP TABLE IF EXISTS menu_categories       CASCADE;
DROP TABLE IF EXISTS role_permissions      CASCADE;
DROP TABLE IF EXISTS permission_functions  CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;
DROP TABLE IF EXISTS app_functions         CASCADE;
DROP TABLE IF EXISTS permissions           CASCADE;
DROP TABLE IF EXISTS roles                 CASCADE;
DROP TABLE IF EXISTS user_sessions         CASCADE;
DROP FUNCTION IF EXISTS set_updated_at()   CASCADE;

-- ---------------------------------------------------------------------
-- อัปเดตคอลัมน์ updated_at อัตโนมัติ
-- ---------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
--  ส่วนที่ 1 : Authentication / Authorization (Role, Permission, ACL)
-- =====================================================================

-- บทบาท (Role) — Admin จัดการผ่านเว็บได้
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50)  NOT NULL UNIQUE
              CHECK (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  is_admin    BOOLEAN      NOT NULL DEFAULT FALSE,   -- TRUE = ได้ทุกสิทธิ์อัตโนมัติ (รวมฟังก์ชันที่เพิ่มภายหลัง)
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,   -- TRUE = Role ระบบ ห้ามลบ
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- รายการ Permission — Admin เพิ่ม/แก้ไข/ลบผ่านเว็บได้ เช่น menu.read, order.review
CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE
              CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_permissions_updated BEFORE UPDATE ON permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ฟังก์ชัน/API ที่ระบบรองรับและถูกป้องกันในโค้ด (จุดตรวจสิทธิ์ใน Middleware)
-- เช่น order.review = POST /app/orders/:id/accept|reject และ POST /api/orders/:id/accept|reject
CREATE TABLE app_functions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  module      VARCHAR(50)  NOT NULL,
  description TEXT,
  endpoints   TEXT,
  sort_order  INTEGER      NOT NULL DEFAULT 0
);

-- Permission ↔ ฟังก์ชัน (Permission หนึ่งเปิดได้หลายฟังก์ชัน) — แก้ผ่านเว็บได้
CREATE TABLE permission_functions (
  permission_id INTEGER NOT NULL REFERENCES permissions(id)   ON DELETE CASCADE,
  function_id   INTEGER NOT NULL REFERENCES app_functions(id) ON DELETE CASCADE,
  PRIMARY KEY (permission_id, function_id)
);

-- ผู้ใช้ (1 คน มี 1 Role)
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE
                CHECK (username ~ '^[A-Za-z0-9_.]{3,50}$'),
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150) UNIQUE,
  phone         VARCHAR(20)  CHECK (phone IS NULL OR phone ~ '^[0-9+\- ]{9,20}$'),
  password_hash VARCHAR(255) NOT NULL,              -- bcrypt (มี salt ในตัว) ไม่เก็บรหัสผ่านจริง
  role_id       INTEGER      NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role_id);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ACL : Role ↔ Permission (ตาราง Role × Permission ในหน้า /admin/acl)
CREATE TABLE role_permissions (
  role_id       INTEGER     NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id INTEGER     NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_id);

-- =====================================================================
--  ส่วนที่ 2 : ระบบงานร้านกาแฟ
-- =====================================================================

-- หมวดเมนู (กาแฟ / ชา / นมและช็อกโกแลต / เบเกอรี่)
CREATE TABLE menu_categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(80) NOT NULL UNIQUE,
  sort_order INTEGER     NOT NULL DEFAULT 0
);

-- เมนู
CREATE TABLE menu_items (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(20)   NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name         VARCHAR(120)  NOT NULL,
  category_id  INTEGER       NOT NULL REFERENCES menu_categories(id) ON DELETE RESTRICT,
  description  TEXT,
  price        NUMERIC(8,2)  NOT NULL CHECK (price > 0 AND price <= 9999),
  is_available BOOLEAN       NOT NULL DEFAULT TRUE,     -- FALSE = หมดชั่วคราว (บาริสต้าปิดได้)
  created_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_menu_category ON menu_items(category_id);
CREATE TRIGGER trg_menu_updated BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ออเดอร์ (กระบวนการหลัก)
-- pending (รอตรวจสลิป) → accepted (ชำระแล้ว รอชง) → brewing → ready → completed
--                      ↘ rejected (สลิปไม่ผ่าน)      ↘ cancelled (ลูกค้ายกเลิกก่อนตรวจ)
CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','brewing','ready','completed','cancelled')),
  total_amount  NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  note          TEXT,                                   -- หมายเหตุจากลูกค้า เช่น เวลามารับ
  reviewed_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,                                   -- เหตุผลเมื่อปฏิเสธสลิป
  barista_id    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  brewing_at    TIMESTAMPTZ,
  ready_at      TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_orders_flow CHECK (
    (status IN ('pending','cancelled') OR reviewed_at IS NOT NULL)
  )
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_orders_created  ON orders(created_at DESC);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- รายการในออเดอร์ (เก็บชื่อและราคา ณ เวลาสั่ง — แก้ราคาเมนูภายหลังไม่กระทบออเดอร์เดิม)
CREATE TABLE order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER      NOT NULL REFERENCES orders(id)     ON DELETE CASCADE,
  menu_item_id  INTEGER      NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  item_name     VARCHAR(120) NOT NULL,
  unit_price    NUMERIC(8,2) NOT NULL CHECK (unit_price > 0),
  quantity      INTEGER      NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  line_total    NUMERIC(10,2) GENERATED ALWAYS AS (unit_price * quantity) STORED
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_menu  ON order_items(menu_item_id);

-- ประวัติการเปลี่ยนสถานะ (ใช้แสดงเส้นทางสถานะของออเดอร์)
CREATE TABLE order_status_history (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  changed_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_history_order ON order_status_history(order_id);

-- ไฟล์ที่อัปโหลด (เก็บไฟล์จริงใน storage/uploads นอกโฟลเดอร์ public)
--   menu_image   : ภาพเมนู      → ผูกกับ menu_items
--   payment_slip : สลิปโอนเงิน → ผูกกับ orders (จำกัดสิทธิ์: เจ้าของออเดอร์ / ผู้ตรวจสลิป)
CREATE TABLE files (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          VARCHAR(20)  NOT NULL CHECK (kind IN ('menu_image', 'payment_slip')),
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) NOT NULL UNIQUE,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INTEGER      NOT NULL CHECK (size_bytes > 0),
  menu_item_id  INTEGER      REFERENCES menu_items(id) ON DELETE CASCADE,
  order_id      INTEGER      REFERENCES orders(id)     ON DELETE CASCADE,
  uploaded_by   INTEGER      REFERENCES users(id)      ON DELETE SET NULL,
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- ไฟล์ต้องผูกกับรายการงานอย่างใดอย่างหนึ่งเท่านั้น
  CONSTRAINT chk_files_owner CHECK (
       (kind = 'menu_image'   AND menu_item_id IS NOT NULL AND order_id IS NULL)
    OR (kind = 'payment_slip' AND order_id     IS NOT NULL AND menu_item_id IS NULL)
  )
);
CREATE INDEX idx_files_menu  ON files(menu_item_id);
CREATE INDEX idx_files_order ON files(order_id);

-- =====================================================================
--  ส่วนที่ 3 : Log การใช้งาน (ไม่เก็บรหัสผ่าน / Session ID / Token)
-- =====================================================================
CREATE TABLE audit_logs (
  id            BIGSERIAL    PRIMARY KEY,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  user_id       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  username      VARCHAR(100),          -- ผู้กระทำ หรือชื่อบัญชีที่พยายามเข้าสู่ระบบ
  role_code     VARCHAR(50),
  category      VARCHAR(30)  NOT NULL, -- auth, order, menu, file, admin, access, navigation
  action        VARCHAR(60)  NOT NULL, -- login_success, order.accept, acl.grant, access_denied ...
  resource_type VARCHAR(50),
  resource_id   VARCHAR(64),
  result        VARCHAR(20)  NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  method        VARCHAR(10),
  path          VARCHAR(255),
  ip            VARCHAR(64),
  user_agent    VARCHAR(255),
  details       JSONB
);
CREATE INDEX idx_logs_created  ON audit_logs(created_at DESC);
CREATE INDEX idx_logs_user     ON audit_logs(user_id);
CREATE INDEX idx_logs_category ON audit_logs(category);
CREATE INDEX idx_logs_action   ON audit_logs(action);

-- =====================================================================
--  ส่วนที่ 4 : Session store (connect-pg-simple)
-- =====================================================================
CREATE TABLE user_sessions (
  sid    VARCHAR      NOT NULL PRIMARY KEY,
  sess   JSON         NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_user_sessions_expire ON user_sessions(expire);
