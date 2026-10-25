// =====================================================================
//  ออเดอร์ (กระบวนการหลัก)
//  ลูกค้าสั่ง + แนบสลิป → ผู้จัดการตรวจสลิป (รับออเดอร์/ปฏิเสธ) → บาริสต้าชง → พร้อมรับ → ส่งมอบ
//  (+ ลูกค้ายกเลิกได้ก่อนร้านตรวจสลิป)
// =====================================================================
const db = require('../db');
const { audit } = require('./auditService');
const { can } = require('./aclService');
const fileService = require('./fileService');
const { Validator } = require('../utils/validator');
const { notFound, conflict, forbidden, validation } = require('../utils/httpError');
const { orderNo } = require('../utils/format');

const STATUSES = ['pending', 'accepted', 'brewing', 'ready', 'completed', 'rejected', 'cancelled'];
const QUEUE_STATUSES = ['accepted', 'brewing', 'ready', 'completed'];
const PAID_STATUSES = QUEUE_STATUSES; // ออเดอร์ที่ร้านรับเงินแล้ว (นับเป็นยอดขาย)
const MAX_QTY_PER_LINE = 20;
const MAX_CUPS_PER_ORDER = 30;

// ---------------------------------------------------------------------
//  ขอบเขตข้อมูลตามสิทธิ์ (เงื่อนไขเจ้าของข้อมูล)
// ---------------------------------------------------------------------
function scopeSql(user, params) {
  if (can(user, 'order.view_all')) return 'TRUE';
  const conds = [];
  if (can(user, 'order.view_queue')) conds.push(`o.status IN ('accepted','brewing','ready','completed')`);
  if (can(user, 'order.view_own')) {
    params.push(user.id);
    conds.push(`o.customer_id = $${params.length}`);
  }
  return conds.length ? `(${conds.join(' OR ')})` : 'FALSE';
}

function canView(user, o) {
  if (can(user, 'order.view_all')) return true;
  if (can(user, 'order.view_queue') && QUEUE_STATUSES.includes(o.status)) return true;
  if (can(user, 'order.view_own') && o.customer_id === user.id) return true;
  return false;
}

const isOwner = (user, o) => o.customer_id === user.id;

function canUploadSlip(user, o) {
  return o.status === 'pending' && can(user, 'slip.upload') && (isOwner(user, o) || user.isAdmin);
}

function canDeleteSlip(user, file, o) {
  if (o.status !== 'pending') return false;
  if (user.isAdmin) return true;
  return can(user, 'slip.delete') && file.uploaded_by === user.id;
}

// ปุ่ม/การกระทำที่ผู้ใช้ทำได้กับออเดอร์นี้ (ใช้แสดงผล — ฝั่ง Server ตรวจซ้ำทุกครั้ง)
function allowedActions(user, o) {
  const reviewer = o.status === 'pending' && can(user, 'order.review') && !isOwner(user, o);
  return {
    accept: reviewer,
    reject: reviewer,
    brew: o.status === 'accepted' && can(user, 'order.brew'),
    ready: o.status === 'brewing' && can(user, 'order.brew'),
    complete: o.status === 'ready' && can(user, 'order.serve'),
    cancel: o.status === 'pending' && can(user, 'order.cancel_own') && isOwner(user, o),
    delete: can(user, 'order.delete') && !['accepted', 'brewing', 'ready'].includes(o.status),
    uploadSlip: canUploadSlip(user, o),
  };
}

const SELECT = `
  SELECT o.*,
         cu.username AS customer_username, cu.full_name AS customer_name, cu.phone AS customer_phone,
         rv.full_name AS reviewer_name, ba.full_name AS barista_name,
         (SELECT COUNT(*) FROM files f WHERE f.order_id = o.id AND f.kind = 'payment_slip') AS slip_count,
         (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS cups,
         (SELECT string_agg(i.item_name || ' ×' || i.quantity, ', ' ORDER BY i.id)
            FROM order_items i WHERE i.order_id = o.id) AS summary
    FROM orders o
    JOIN users cu ON cu.id = o.customer_id
    LEFT JOIN users rv ON rv.id = o.reviewed_by
    LEFT JOIN users ba ON ba.id = o.barista_id`;

async function list(user, { status, q, mine, page = 1, pageSize = 20 } = {}) {
  const params = [];
  const where = [scopeSql(user, params)];
  if (status && STATUSES.includes(status)) { params.push(status); where.push(`o.status = $${params.length}`); }
  if (mine) { params.push(user.id); where.push(`o.customer_id = $${params.length}`); }
  if (q) {
    const idMatch = /^(?:K-?)?0*(\d{1,9})$/i.exec(q.trim());
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    let cond = `(cu.full_name ILIKE ${p} OR cu.username ILIKE ${p}
                OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.item_name ILIKE ${p})`;
    if (idMatch) { params.push(parseInt(idMatch[1], 10)); cond += ` OR o.id = $${params.length}`; }
    where.push(`${cond})`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = (await db.query(
    `SELECT COUNT(*) AS n FROM orders o JOIN users cu ON cu.id = o.customer_id ${whereSql}`, params,
  )).rows[0].n;
  const rows = (await db.query(
    `${SELECT} ${whereSql} ORDER BY o.created_at DESC LIMIT ${Number(pageSize)} OFFSET ${(Number(page) - 1) * Number(pageSize)}`,
    params,
  )).rows;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function countByStatus(user) {
  const params = [];
  const scope = scopeSql(user, params);
  const rows = (await db.query(
    `SELECT o.status, COUNT(*) AS n FROM orders o WHERE ${scope} GROUP BY o.status`, params,
  )).rows;
  const out = { total: 0 };
  for (const s of STATUSES) out[s] = 0;
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}

async function findRaw(id, client = db) {
  const o = (await client.query(`${SELECT} WHERE o.id = $1`, [id])).rows[0];
  if (!o) throw notFound('ไม่พบออเดอร์');
  return o;
}

// ดึงออเดอร์พร้อมตรวจสิทธิ์การมองเห็น (ไม่ใช่เจ้าของ/ไม่มีสิทธิ์ → 403 และบันทึก Log)
async function getForUser(user, id) {
  const o = await findRaw(id);
  if (!canView(user, o)) {
    throw forbidden('คุณไม่มีสิทธิ์ดูออเดอร์นี้ (ดูได้เฉพาะออเดอร์ที่อยู่ในขอบเขตสิทธิ์ของคุณ)', {
      resourceType: 'order', resourceId: id, reason: 'not_in_scope',
    });
  }
  return o;
}

async function itemsOf(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = (await db.query(
    `SELECT i.*, m.code AS menu_code FROM order_items i JOIN menu_items m ON m.id = i.menu_item_id
      WHERE i.order_id = ANY($1) ORDER BY i.id`, [orderIds],
  )).rows;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.order_id)) map.set(r.order_id, []);
    map.get(r.order_id).push(r);
  }
  return map;
}

async function detail(user, id) {
  const o = await getForUser(user, id);
  o.items = (await itemsOf([o.id])).get(o.id) || [];
  o.slips = (await db.query(
    `SELECT f.*, u.full_name AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.order_id = $1 AND f.kind = 'payment_slip' ORDER BY f.uploaded_at DESC`, [id],
  )).rows;
  o.history = (await db.query(
    `SELECT h.*, u.full_name AS changed_by_name FROM order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = $1 ORDER BY h.changed_at, h.id`, [id],
  )).rows;
  o.actions = allowedActions(user, o);
  o.canSeeSlip = can(user, 'slip.view');
  o.slips.forEach((f) => { f.canDelete = canDeleteSlip(user, f, o); });
  return o;
}

// คิวบาร์ (บาริสต้า): รอชง / กำลังชง / พร้อมรับ + ส่งมอบล่าสุดวันนี้
async function queue(user) {
  const rows = (await db.query(
    `${SELECT} WHERE o.status IN ('accepted','brewing','ready') ORDER BY o.reviewed_at NULLS LAST, o.created_at`,
  )).rows;
  const done = (await db.query(
    `${SELECT} WHERE o.status = 'completed' AND o.completed_at >= date_trunc('day', now())
      ORDER BY o.completed_at DESC LIMIT 8`,
  )).rows;
  const items = await itemsOf(rows.map((r) => r.id));
  for (const r of rows) {
    r.items = items.get(r.id) || [];
    r.actions = allowedActions(user, r);
  }
  return {
    accepted: rows.filter((r) => r.status === 'accepted'),
    brewing: rows.filter((r) => r.status === 'brewing'),
    ready: rows.filter((r) => r.status === 'ready'),
    done,
  };
}

// ---------------------------------------------------------------------
//  1) สั่งเครื่องดื่ม — ราคาคำนวณจากฐานข้อมูลเสมอ (ไม่เชื่อราคาจาก Browser)
// ---------------------------------------------------------------------
// รับได้ทั้งฟอร์ม (qty[m<menuId>]) และ JSON ({ items: [{ menu_item_id, quantity }] })
// หมายเหตุ: ใช้คีย์ขึ้นต้นด้วย m เพราะ body parser จะตีความคีย์ที่เป็นตัวเลขล้วนเป็นอาร์เรย์
function readLines(input) {
  if (Array.isArray(input.items)) {
    return input.items.map((it) => ({ menuId: it && it.menu_item_id, qty: it && it.quantity }));
  }
  const qty = input.qty && typeof input.qty === 'object' && !Array.isArray(input.qty) ? input.qty : {};
  return Object.entries(qty)
    .filter(([, n]) => String(n).trim() !== '' && String(n).trim() !== '0')
    .map(([key, n]) => ({ menuId: String(key).replace(/^m/, ''), qty: n }));
}

async function create(req, input = {}) {
  // 1) ตรวจข้อมูลที่ส่งมา
  const v = new Validator(input);
  v.string('note', 'หมายเหตุ', { required: false, max: 200 });
  const errors = {};
  const lines = [];
  for (const l of readLines(input)) {
    const menuId = /^\d{1,9}$/.test(String(l.menuId)) ? Number(l.menuId) : null;
    const qty = /^\d{1,3}$/.test(String(l.qty).trim()) ? Number(String(l.qty).trim()) : 0;
    if (!menuId) errors.items = 'รายการเมนูไม่ถูกต้อง';
    else if (qty < 1 || qty > MAX_QTY_PER_LINE) errors[`qty_${menuId}`] = `จำนวนต้องอยู่ระหว่าง 1–${MAX_QTY_PER_LINE}`;
    else lines.push({ menuId, qty });
  }
  if (!lines.length && !Object.keys(errors).length) errors.items = 'กรุณาเลือกอย่างน้อย 1 รายการ';
  if (lines.reduce((s, l) => s + l.qty, 0) > MAX_CUPS_PER_ORDER) errors.items = `สั่งได้ไม่เกิน ${MAX_CUPS_PER_ORDER} รายการต่อออเดอร์`;
  if (!v.ok || Object.keys(errors).length) throw validation({ ...v.errors, ...errors });

  // 2) บันทึกออเดอร์ในฐานข้อมูล — ราคาอ่านจากตารางเมนูเสมอ (ไม่เชื่อราคาจาก Browser)
  const row = await db.withTransaction(async (client) => {
    const menu = (await client.query('SELECT * FROM menu_items WHERE id = ANY($1)', [lines.map((l) => l.menuId)])).rows;
    const byId = new Map(menu.map((m) => [m.id, m]));
    for (const l of lines) {
      const m = byId.get(l.menuId);
      if (!m) throw validation({ items: 'บางเมนูไม่มีในระบบแล้ว กรุณาเลือกใหม่' });
      if (!m.is_available) throw validation({ [`qty_${l.menuId}`]: `${m.name} หมดชั่วคราว` });
    }
    const total = lines.reduce((s, l) => s + Number(byId.get(l.menuId).price) * l.qty, 0);
    const o = (await client.query(
      'INSERT INTO orders (customer_id, total_amount, note) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, total, v.data.note],
    )).rows[0];
    for (const l of lines) {
      const m = byId.get(l.menuId);
      await client.query(
        'INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)',
        [o.id, m.id, m.name, m.price, l.qty],
      );
    }
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'pending', $2, 'สั่งเครื่องดื่ม')`, [o.id, req.user.id],
    );
    return { ...o, lines: lines.map((l) => ({ code: byId.get(l.menuId).code, qty: l.qty })) };
  });

  // 3) บันทึก Log
  await audit(req, {
    category: 'order', action: 'order.create', resourceType: 'order', resourceId: row.id,
    details: { order_no: orderNo(row.id), total: Number(row.total_amount), items: row.lines },
  });
  return row;
}

// ---------------------------------------------------------------------
//  ตัวช่วยเปลี่ยนสถานะใน Transaction (ล็อกแถวกันการกดซ้ำพร้อมกัน)
// ---------------------------------------------------------------------
async function transition(req, id, { from, to, action, note, apply }) {
  const result = await db.withTransaction(async (client) => {
    const o = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!o) throw notFound('ไม่พบออเดอร์');
    if (!from.includes(o.status)) {
      throw conflict(`ทำรายการไม่ได้ เนื่องจากออเดอร์นี้อยู่ในสถานะ "${o.status}" แล้ว`);
    }
    const extra = (await apply(client, o)) || {};
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES ($1,$2,$3,$4,$5)`, [id, o.status, to, req.user.id, note || null],
    );
    return { o, extra };
  });
  await audit(req, {
    category: 'order', action, resourceType: 'order', resourceId: id,
    details: { order_no: orderNo(id), from: result.o.status, to, note: note || undefined, ...result.extra },
  });
  return result.o;
}

function noSelfReview(req, o, id) {
  if (o.customer_id === req.user.id) {
    throw forbidden('ไม่สามารถตรวจสลิปออเดอร์ของตนเองได้', { resourceType: 'order', resourceId: id, reason: 'self_review' });
  }
}

// ---------------------------------------------------------------------
//  2) ตรวจสลิป : รับออเดอร์ / ปฏิเสธ
// ---------------------------------------------------------------------
async function accept(req, id, input = {}) {
  const note = String(input.note || '').trim().slice(0, 300) || 'ตรวจสลิปแล้ว ยอดตรง';
  return transition(req, id, {
    from: ['pending'], to: 'accepted', action: 'order.accept', note,
    apply: async (client, o) => {
      noSelfReview(req, o, id);
      const slips = (await client.query(
        `SELECT COUNT(*) AS n FROM files WHERE order_id=$1 AND kind='payment_slip'`, [id],
      )).rows[0].n;
      if (!slips) throw conflict('ยังรับออเดอร์ไม่ได้ — ลูกค้ายังไม่ได้แนบสลิปโอนเงิน');
      await client.query(
        `UPDATE orders SET status='accepted', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3`,
        [req.user.id, note, id],
      );
      return { total: Number(o.total_amount) };
    },
  });
}

async function reject(req, id, input = {}) {
  const note = String(input.note || '').trim();
  if (note.length < 3) throw validation({ note: 'กรุณาระบุเหตุผลที่สลิปไม่ผ่าน (อย่างน้อย 3 ตัวอักษร)' });
  return transition(req, id, {
    from: ['pending'], to: 'rejected', action: 'order.reject', note: note.slice(0, 300),
    apply: async (client, o) => {
      noSelfReview(req, o, id);
      await client.query(
        `UPDATE orders SET status='rejected', reviewed_by=$1, reviewed_at=now(), review_note=$2 WHERE id=$3`,
        [req.user.id, note.slice(0, 300), id],
      );
    },
  });
}

// ---------------------------------------------------------------------
//  3) บาร์ : เริ่มชง → ชงเสร็จ → ส่งมอบ
// ---------------------------------------------------------------------
async function brew(req, id) {
  return transition(req, id, {
    from: ['accepted'], to: 'brewing', action: 'order.brew', note: 'เริ่มชง',
    apply: async (client) => {
      await client.query(`UPDATE orders SET status='brewing', barista_id=$1, brewing_at=now() WHERE id=$2`, [req.user.id, id]);
    },
  });
}

async function markReady(req, id) {
  return transition(req, id, {
    from: ['brewing'], to: 'ready', action: 'order.ready', note: 'ชงเสร็จ รอลูกค้ารับ',
    apply: async (client, o) => {
      await client.query(
        `UPDATE orders SET status='ready', ready_at=now(), barista_id=COALESCE(barista_id, $1) WHERE id=$2`,
        [req.user.id, id],
      );
      return { minutes_to_brew: o.brewing_at ? Math.round((Date.now() - new Date(o.brewing_at).getTime()) / 60000) : null };
    },
  });
}

async function complete(req, id) {
  return transition(req, id, {
    from: ['ready'], to: 'completed', action: 'order.complete', note: 'ส่งมอบแล้ว',
    apply: async (client) => {
      await client.query(`UPDATE orders SET status='completed', completed_at=now() WHERE id=$1`, [id]);
    },
  });
}

// ---------------------------------------------------------------------
//  ยกเลิก (เฉพาะเจ้าของ ก่อนร้านตรวจสลิป) / ลบ
// ---------------------------------------------------------------------
async function cancel(req, id) {
  return transition(req, id, {
    from: ['pending'], to: 'cancelled', action: 'order.cancel', note: 'ลูกค้ายกเลิกออเดอร์',
    apply: async (client, o) => {
      if (o.customer_id !== req.user.id) {
        throw forbidden('ยกเลิกได้เฉพาะออเดอร์ของตนเอง', { resourceType: 'order', resourceId: id, reason: 'not_owner' });
      }
      await client.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [id]);
    },
  });
}

async function remove(req, id) {
  const { o, files } = await db.withTransaction(async (client) => {
    const row = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw notFound('ไม่พบออเดอร์');
    if (['accepted', 'brewing', 'ready'].includes(row.status)) {
      throw conflict('ลบไม่ได้: ออเดอร์นี้ชำระแล้วและยังอยู่ในคิวบาร์ — ส่งมอบให้เสร็จก่อน');
    }
    const fileRows = (await client.query('SELECT stored_name FROM files WHERE order_id=$1', [id])).rows;
    await client.query('DELETE FROM orders WHERE id=$1', [id]);
    return { o: row, files: fileRows };
  });
  for (const f of files) await fileService.removeStored(f.stored_name);
  await audit(req, {
    category: 'order', action: 'order.delete', resourceType: 'order', resourceId: id,
    details: { order_no: orderNo(id), status: o.status, total: Number(o.total_amount), files_deleted: files.length },
  });
}

// ---------------------------------------------------------------------
//  สลิปโอนเงิน
// ---------------------------------------------------------------------
async function uploadSlip(req, id, file) {
  const o = await getForUser(req.user, id);
  if (!canUploadSlip(req.user, o)) {
    throw forbidden(
      o.status === 'pending' ? 'แนบสลิปได้เฉพาะออเดอร์ของตนเอง' : 'ออเดอร์นี้ผ่านขั้นตรวจสลิปแล้ว แนบสลิปเพิ่มไม่ได้',
      { resourceType: 'order', resourceId: id, reason: 'slip_upload_not_allowed' },
    );
  }
  const old = (await db.query(
    `SELECT id, stored_name, original_name FROM files WHERE order_id=$1 AND kind='payment_slip'`, [id],
  )).rows;
  const saved = await fileService.saveUpload(req, { kind: 'payment_slip', file, orderId: id });
  for (const f of old) {
    await db.query('DELETE FROM files WHERE id=$1', [f.id]);
    await fileService.removeStored(f.stored_name);
  }
  await audit(req, {
    category: 'file', action: 'file.upload', resourceType: 'order', resourceId: id,
    details: {
      file_id: saved.id, kind: 'payment_slip', order_no: orderNo(id),
      original_name: saved.original_name, mime: saved.mime_type, size: saved.size_bytes,
      replaced: old.map((f) => f.original_name),
    },
  });
  return saved;
}

// ตรวจสิทธิ์เปิดไฟล์ (ทั้งภาพเมนูและสลิป)
async function assertCanViewFile(user, file) {
  if (file.kind === 'menu_image') {
    if (can(user, 'menu.view')) return;
  } else if (can(user, 'slip.view')) {
    const o = await findRaw(file.order_id);
    if (canView(user, o)) return;
  }
  throw forbidden('คุณไม่มีสิทธิ์เปิดไฟล์นี้', {
    resourceType: 'file', resourceId: file.id, reason: 'file_access_denied', fileAccess: true,
  });
}

async function deleteSlip(req, fileId) {
  const file = await fileService.getFile(fileId);
  if (file.kind !== 'payment_slip') throw notFound('ไม่พบสลิป');
  const o = await findRaw(file.order_id);
  if (!canView(req.user, o) || !canDeleteSlip(req.user, file, o)) {
    throw forbidden('ลบได้เฉพาะสลิปที่ตนเองอัปโหลด และออเดอร์ยังรอตรวจ', {
      resourceType: 'file', resourceId: file.id, reason: 'file_delete_denied', fileAccess: true,
    });
  }
  await db.query('DELETE FROM files WHERE id=$1', [file.id]);
  await fileService.removeStored(file.stored_name);
  await audit(req, {
    category: 'file', action: 'file.delete', resourceType: 'order', resourceId: o.id,
    details: { file_id: file.id, kind: 'payment_slip', order_no: orderNo(o.id), original_name: file.original_name },
  });
  return o.id;
}

module.exports = {
  STATUSES, QUEUE_STATUSES, PAID_STATUSES, MAX_QTY_PER_LINE, MAX_CUPS_PER_ORDER,
  list, countByStatus, detail, queue, getForUser, canView, create,
  accept, reject, brew, markReady, complete, cancel, remove, uploadSlip, assertCanViewFile, deleteSlip,
};
