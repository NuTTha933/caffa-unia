// =====================================================================
//  ไฟล์อัปโหลด : ตรวจชนิดจาก "เนื้อไฟล์" (magic bytes) + ขนาด, ตั้งชื่อไม่ซ้ำ, เก็บนอก public
// =====================================================================
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { audit } = require('./auditService');
const { badRequest, notFound, HttpError } = require('../utils/httpError');
const { fileSize } = require('../utils/format');

const UPLOAD_DIR = config.upload.dir;
const STORED_NAME = /^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

const TYPE_LABEL = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'application/pdf': 'PDF',
};

// ตรวจชนิดไฟล์จากไบต์แรกของไฟล์ (ไม่เชื่อนามสกุลหรือ Content-Type ที่ Browser ส่งมา)
function detectType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

// ทำความสะอาดชื่อไฟล์เดิม (ใช้แสดงผลเท่านั้น ไม่ใช้เป็น path)
function safeOriginalName(name) {
  let s = String(name || 'file');
  s = path.basename(s.replace(/\\/g, '/')); // ตัด path ออก กัน ../../ หรือ C:\...
  s = s.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim();
  if (!s || s === '.' || s === '..') s = 'file';
  return s.length > 200 ? s.slice(-200) : s;
}

function storedPath(storedName) {
  if (!STORED_NAME.test(storedName)) throw new HttpError(500, 'ชื่อไฟล์จัดเก็บไม่ถูกต้อง');
  const full = path.resolve(UPLOAD_DIR, storedName);
  if (!full.startsWith(UPLOAD_DIR + path.sep)) throw new HttpError(500, 'เส้นทางไฟล์ไม่ปลอดภัย');
  return full;
}

function describeRule(kind) {
  const rule = config.upload.rules[kind];
  return `${rule.types.map((t) => TYPE_LABEL[t]).join(', ')} ขนาดไม่เกิน ${fileSize(rule.maxBytes)}`;
}

async function rejectUpload(req, kind, file, reason, message, extra = {}) {
  await audit(req, {
    category: 'file', action: 'file.upload_rejected', result: 'failure',
    resourceType: extra.resourceType, resourceId: extra.resourceId,
    details: {
      kind, reason,
      original_name: file ? safeOriginalName(file.originalname) : null,
      size: file ? file.size : null,
      browser_type: file ? file.mimetype : null,
      ...extra.details,
    },
  });
  return badRequest(message);
}

/**
 * ตรวจและบันทึกไฟล์ที่อัปโหลด (ไฟล์อยู่ในหน่วยความจำจาก multer)
 * @returns แถวข้อมูลไฟล์ในตาราง files
 */
async function saveUpload(req, { kind, file, menuItemId = null, orderId = null, client = db }) {
  const rule = config.upload.rules[kind];
  const target = { resourceType: menuItemId ? 'menu' : 'order', resourceId: menuItemId || orderId };
  if (!file) throw await rejectUpload(req, kind, null, 'no_file', 'กรุณาเลือกไฟล์ที่ต้องการอัปโหลด', target);
  if (file.size > rule.maxBytes || file.buffer.length > rule.maxBytes) {
    throw await rejectUpload(req, kind, file, 'too_large',
      `ไฟล์มีขนาด ${fileSize(file.size)} เกินกำหนด (${rule.label}รับได้ ${describeRule(kind)})`, target);
  }
  const type = detectType(file.buffer);
  if (!type || !rule.types.includes(type.mime)) {
    throw await rejectUpload(req, kind, file, 'invalid_type',
      `ชนิดไฟล์ไม่ได้รับอนุญาต — ${rule.label}รับเฉพาะ ${describeRule(kind)} (ระบบตรวจจากเนื้อไฟล์ ไม่ใช่นามสกุล)`,
      { ...target, details: { detected: type ? type.mime : 'unknown' } });
  }

  const storedName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const fullPath = storedPath(storedName);
  await fs.writeFile(fullPath, file.buffer, { flag: 'wx' }); // wx = ห้ามเขียนทับไฟล์ที่มีอยู่

  try {
    const row = (await client.query(
      `INSERT INTO files (kind, original_name, stored_name, mime_type, size_bytes, menu_item_id, order_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [kind, safeOriginalName(file.originalname), storedName, type.mime, file.size, menuItemId, orderId, req.user.id],
    )).rows[0];
    return row;
  } catch (err) {
    await fs.unlink(fullPath).catch(() => {});
    throw err;
  }
}

async function getFile(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw notFound('ไม่พบไฟล์');
  }
  const f = (await db.query(
    `SELECT f.*, u.username AS uploader_username, u.full_name AS uploader_name,
            o.customer_id, o.status AS order_status
       FROM files f
       LEFT JOIN users u ON u.id = f.uploaded_by
       LEFT JOIN orders o ON o.id = f.order_id
      WHERE f.id = $1`,
    [id],
  )).rows[0];
  if (!f) throw notFound('ไม่พบไฟล์');
  return f;
}

async function removeStored(storedName) {
  try {
    await fs.unlink(storedPath(storedName));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[file] ลบไฟล์ไม่สำเร็จ:', err.message);
  }
}

module.exports = {
  detectType, safeOriginalName, storedPath, saveUpload, getFile, removeStored, describeRule, rejectUpload, TYPE_LABEL,
};
