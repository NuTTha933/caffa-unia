const TZ = 'Asia/Bangkok';

const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dateTimeSecFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric',
});

function dateTime(v, withSeconds = false) {
  if (!v) return '-';
  return (withSeconds ? dateTimeSecFmt : dateTimeFmt).format(new Date(v));
}

function date(v) {
  if (!v) return '-';
  const d = typeof v === 'string' ? new Date(`${v}T00:00:00+07:00`) : new Date(v);
  return dateFmt.format(d);
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

const ORDER_STATUS = {
  pending:   { label: 'รอตรวจสลิป', short: 'รอตรวจ', tone: 'warn' },
  accepted:  { label: 'รอชง',        short: 'รอชง',   tone: 'info' },
  brewing:   { label: 'กำลังชง',     short: 'กำลังชง', tone: 'accent' },
  ready:     { label: 'พร้อมรับ',    short: 'พร้อมรับ', tone: 'ok' },
  completed: { label: 'รับแล้ว',     short: 'รับแล้ว', tone: 'done' },
  rejected:  { label: 'สลิปไม่ผ่าน',  short: 'ไม่ผ่าน', tone: 'danger' },
  cancelled: { label: 'ยกเลิก',      short: 'ยกเลิก', tone: 'done' },
};

const ORDER_STEPS = [
  { key: 'pending', label: 'สั่งและแนบสลิป' },
  { key: 'accepted', label: 'ร้านตรวจสลิป' },
  { key: 'brewing', label: 'กำลังชง' },
  { key: 'ready', label: 'พร้อมรับ' },
  { key: 'completed', label: 'รับแล้ว' },
];

const LOG_CATEGORIES = {
  auth: 'เข้าสู่ระบบ / ออกจากระบบ',
  order: 'ออเดอร์',
  menu: 'เมนู',
  file: 'ไฟล์',
  admin: 'จัดการผู้ใช้ / บทบาท / สิทธิ์',
  access: 'การเข้าถึงที่ถูกปฏิเสธ',
  navigation: 'การเข้าใช้หน้าเว็บ / API',
};

const LOG_RESULTS = {
  success: { label: 'สำเร็จ', color: 'green' },
  failure: { label: 'ล้มเหลว', color: 'orange' },
  denied: { label: 'ถูกปฏิเสธ', color: 'red' },
};

const MODULE_LABELS = {
  menu: 'เมนู',
  order: 'ออเดอร์',
  file: 'สลิปและไฟล์',
  report: 'รายงาน',
  log: 'Log',
  admin: 'ส่วนผู้ดูแลระบบ',
};

const PERMISSION_GROUPS = {
  menu: 'เมนู', order: 'ออเดอร์', slip: 'สลิปโอนเงิน', report: 'รายงาน', log: 'Log',
  user: 'ผู้ใช้', role: 'บทบาท', permission: 'Permission', acl: 'ACL',
};

function orderNo(id) {
  return `K-${String(id).padStart(4, '0')}`;
}

function baht(n) {
  const v = Number(n || 0);
  return v.toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}

const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
function time(v) {
  return v ? timeFmt.format(new Date(v)) : '-';
}
function ago(v) {
  if (!v) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  if (min < 1) return 'เมื่อสักครู่';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

const longDateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function longDate(v = new Date()) {
  return longDateFmt.format(new Date(v));
}

function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(2)} MB`;
}

function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function qs(current, changes = {}) {
  const params = new URLSearchParams();
  const merged = { ...current, ...changes };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

module.exports = {
  dateTime, date, time, ago, longDate, todayISO, addDaysISO, daysBetween, orderNo, baht, fileSize, initials, qs,
  ORDER_STATUS, ORDER_STEPS, LOG_CATEGORIES, LOG_RESULTS, MODULE_LABELS, PERMISSION_GROUPS,
};
