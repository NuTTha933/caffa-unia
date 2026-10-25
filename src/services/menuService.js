// =====================================================================
//  เมนู : CRUD + เปิด/ปิดการขาย + ภาพเมนู
// =====================================================================
const db = require('../db');
const { audit } = require('./auditService');
const fileService = require('./fileService');
const { Validator } = require('../utils/validator');
const { notFound, conflict, validation } = require('../utils/httpError');

const SELECT = `
  SELECT m.*, c.name AS category_name, c.sort_order AS category_order,
         (SELECT f.id FROM files f WHERE f.menu_item_id = m.id AND f.kind = 'menu_image'
           ORDER BY f.uploaded_at DESC LIMIT 1) AS image_id
    FROM menu_items m
    JOIN menu_categories c ON c.id = m.category_id`;

async function categories() {
  return (await db.query('SELECT * FROM menu_categories ORDER BY sort_order, name')).rows;
}

async function list({ q, categoryId, availableOnly = false } = {}) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(m.code ILIKE $${params.length} OR m.name ILIKE $${params.length} OR m.description ILIKE $${params.length})`);
  }
  if (categoryId) { params.push(categoryId); where.push(`m.category_id = $${params.length}`); }
  if (availableOnly) where.push('m.is_available');
  return (await db.query(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.sort_order, m.code`, params,
  )).rows;
}

// จัดกลุ่มตามหมวด (ใช้แสดงเป็นเมนูบอร์ด)
function groupByCategory(items) {
  const groups = [];
  for (const it of items) {
    let g = groups.find((x) => x.id === it.category_id);
    if (!g) { g = { id: it.category_id, name: it.category_name, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return groups;
}

async function get(id) {
  const m = (await db.query(`${SELECT} WHERE m.id = $1`, [id])).rows[0];
  if (!m) throw notFound('ไม่พบเมนู');
  return m;
}

async function validateMenu(input) {
  const v = new Validator(input);
  v.string('code', 'รหัสเมนู', {
    min: 2, max: 20, pattern: /^[A-Za-z0-9-]+$/, patternMessage: 'รหัสเมนูใช้ A-Z, 0-9 และ - เท่านั้น',
  })
    .string('name', 'ชื่อเมนู', { max: 120 })
    .int('category_id', 'หมวด', { min: 1 })
    .string('description', 'คำอธิบาย', { required: false, max: 500 })
    .money('price', 'ราคา', { min: 1, max: 9999 })
    .bool('is_available');
  const d = v.data;
  if (d.category_id && !(await db.query('SELECT 1 FROM menu_categories WHERE id=$1', [d.category_id])).rowCount) {
    v.error('category_id', 'ไม่พบหมวดที่เลือก');
  }
  const data = v.done();
  data.code = data.code.toUpperCase();
  return data;
}

async function create(req, input) {
  const data = await validateMenu(input);
  let row;
  try {
    row = (await db.query(
      `INSERT INTO menu_items (code, name, category_id, description, price, is_available, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.code, data.name, data.category_id, data.description, data.price, data.is_available, req.user.id],
    )).rows[0];
  } catch (err) {
    if (err.code === '23505') throw validation({ code: 'รหัสเมนูนี้มีอยู่แล้ว' });
    throw err;
  }
  await audit(req, {
    category: 'menu', action: 'menu.create', resourceType: 'menu', resourceId: row.id,
    details: { code: row.code, name: row.name, price: Number(row.price) },
  });
  return row;
}

async function update(req, id, input) {
  const data = await validateMenu(input);
  let result;
  try {
    result = await db.withTransaction(async (client) => {
      const before = (await client.query('SELECT * FROM menu_items WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!before) throw notFound('ไม่พบเมนู');
      const after = (await client.query(
        `UPDATE menu_items SET code=$1, name=$2, category_id=$3, description=$4, price=$5, is_available=$6
          WHERE id=$7 RETURNING *`,
        [data.code, data.name, data.category_id, data.description, data.price, data.is_available, id],
      )).rows[0];
      return { before, after };
    });
  } catch (err) {
    if (err.code === '23505') throw validation({ code: 'รหัสเมนูนี้มีอยู่แล้ว' });
    throw err;
  }
  const changes = {};
  for (const k of ['code', 'name', 'category_id', 'description', 'price', 'is_available']) {
    if (String(result.before[k] ?? '') !== String(result.after[k] ?? '')) changes[k] = [result.before[k], result.after[k]];
  }
  await audit(req, {
    category: 'menu', action: 'menu.update', resourceType: 'menu', resourceId: id,
    details: { code: result.after.code, changes },
  });
  return result.after;
}

// เปิด/ปิดการขาย (ของหมด) — บาริสต้าทำได้โดยไม่ต้องมีสิทธิ์แก้ไขเมนู
async function setAvailability(req, id, available) {
  const before = await get(id);
  const row = (await db.query(
    'UPDATE menu_items SET is_available=$1 WHERE id=$2 RETURNING *', [!!available, id],
  )).rows[0];
  await audit(req, {
    category: 'menu', action: available ? 'menu.available' : 'menu.sold_out', resourceType: 'menu', resourceId: id,
    details: { code: row.code, name: row.name, from: before.is_available, to: row.is_available },
  });
  return row;
}

async function remove(req, id) {
  const { item, files } = await db.withTransaction(async (client) => {
    const row = (await client.query('SELECT * FROM menu_items WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw notFound('ไม่พบเมนู');
    const n = (await client.query('SELECT COUNT(*) AS n FROM order_items WHERE menu_item_id=$1', [id])).rows[0].n;
    if (n > 0) {
      throw conflict(`ลบไม่ได้: เมนูนี้อยู่ในออเดอร์ ${n} รายการ — ปิดการขายแทน เพื่อเก็บประวัติยอดขายไว้`);
    }
    const fileRows = (await client.query('SELECT stored_name FROM files WHERE menu_item_id=$1', [id])).rows;
    await client.query('DELETE FROM menu_items WHERE id=$1', [id]);
    return { item: row, files: fileRows };
  });
  for (const f of files) await fileService.removeStored(f.stored_name);
  await audit(req, {
    category: 'menu', action: 'menu.delete', resourceType: 'menu', resourceId: id,
    details: { code: item.code, name: item.name },
  });
}

// อัปโหลด/เปลี่ยนภาพเมนู (เก็บภาพล่าสุดภาพเดียว)
async function setImage(req, id, file) {
  const item = await get(id);
  const oldFiles = (await db.query(
    `SELECT id, stored_name, original_name FROM files WHERE menu_item_id=$1 AND kind='menu_image'`, [id],
  )).rows;
  const saved = await fileService.saveUpload(req, { kind: 'menu_image', file, menuItemId: id });
  for (const f of oldFiles) {
    await db.query('DELETE FROM files WHERE id=$1', [f.id]);
    await fileService.removeStored(f.stored_name);
  }
  await audit(req, {
    category: 'file', action: 'file.upload', resourceType: 'menu', resourceId: id,
    details: {
      file_id: saved.id, kind: 'menu_image', menu: item.code,
      original_name: saved.original_name, mime: saved.mime_type, size: saved.size_bytes,
      replaced: oldFiles.map((f) => f.original_name),
    },
  });
  return saved;
}

async function removeImage(req, id) {
  const item = await get(id);
  const files = (await db.query(
    `DELETE FROM files WHERE menu_item_id=$1 AND kind='menu_image' RETURNING id, stored_name, original_name`, [id],
  )).rows;
  for (const f of files) {
    await fileService.removeStored(f.stored_name);
    await audit(req, {
      category: 'file', action: 'file.delete', resourceType: 'menu', resourceId: id,
      details: { file_id: f.id, kind: 'menu_image', menu: item.code, original_name: f.original_name },
    });
  }
  return files.length;
}

// สถิติเมนู (แสดงในหน้ารายละเอียดเมนู — ไม่มีข้อมูลส่วนตัวลูกค้า)
async function stats(id) {
  return (await db.query(
    `SELECT COALESCE(SUM(i.quantity),0)::int AS cups, COUNT(DISTINCT i.order_id)::int AS orders
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.menu_item_id = $1 AND o.status IN ('accepted','brewing','ready','completed')`, [id],
  )).rows[0];
}

module.exports = {
  categories, list, groupByCategory, get, create, update, setAvailability, remove, setImage, removeImage, stats,
};
