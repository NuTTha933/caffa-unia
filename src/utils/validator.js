// ตัวช่วยตรวจสอบข้อมูลฝั่ง Server (ไม่เชื่อการตรวจใน Browser)
const { validation } = require('./httpError');

class Validator {
  constructor(input) {
    this.input = input || {};
    this.data = {};
    this.errors = {};
  }

  raw(field) {
    const v = this.input[field];
    return Array.isArray(v) ? v[0] : v;
  }

  error(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }

  string(field, label, { required = true, min = 0, max = 255, pattern, patternMessage, lower = false } = {}) {
    let v = this.raw(field);
    v = v === undefined || v === null ? '' : String(v).trim();
    if (lower) v = v.toLowerCase();
    if (!v) {
      if (required) this.error(field, `กรุณากรอก${label}`);
      this.data[field] = null;
      return this;
    }
    if (v.length < min) this.error(field, `${label}ต้องมีอย่างน้อย ${min} ตัวอักษร`);
    else if (v.length > max) this.error(field, `${label}ต้องไม่เกิน ${max} ตัวอักษร`);
    else if (pattern && !pattern.test(v)) this.error(field, patternMessage || `${label}มีรูปแบบไม่ถูกต้อง`);
    this.data[field] = v;
    return this;
  }

  int(field, label, { required = true, min = -Infinity, max = Infinity } = {}) {
    const raw = this.raw(field);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (required) this.error(field, `กรุณากรอก${label}`);
      this.data[field] = null;
      return this;
    }
    const s = String(raw).trim();
    if (!/^-?\d+$/.test(s)) {
      this.error(field, `${label}ต้องเป็นจำนวนเต็ม`);
      return this;
    }
    const n = parseInt(s, 10);
    if (n < min) this.error(field, `${label}ต้องไม่น้อยกว่า ${min}`);
    else if (n > max) this.error(field, `${label}ต้องไม่เกิน ${max}`);
    this.data[field] = n;
    return this;
  }

  // จำนวนเงิน (ทศนิยมไม่เกิน 2 ตำแหน่ง)
  money(field, label, { required = true, min = 0, max = 999999 } = {}) {
    const raw = this.raw(field);
    const s = raw === undefined || raw === null ? '' : String(raw).trim().replace(/,/g, '');
    if (!s) {
      if (required) this.error(field, `กรุณากรอก${label}`);
      this.data[field] = null;
      return this;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      this.error(field, `${label}ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง`);
      return this;
    }
    const n = Number(s);
    if (n < min) this.error(field, `${label}ต้องไม่น้อยกว่า ${min}`);
    else if (n > max) this.error(field, `${label}ต้องไม่เกิน ${max.toLocaleString('th-TH')}`);
    this.data[field] = n;
    return this;
  }

  date(field, label, { required = true } = {}) {
    const raw = this.raw(field);
    const s = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!s) {
      if (required) this.error(field, `กรุณาเลือก${label}`);
      this.data[field] = null;
      return this;
    }
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
    if (!ok) this.error(field, `${label}ไม่ถูกต้อง`);
    this.data[field] = s;
    return this;
  }

  oneOf(field, label, values, { required = true } = {}) {
    const raw = this.raw(field);
    const s = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!s) {
      if (required) this.error(field, `กรุณาเลือก${label}`);
      this.data[field] = null;
      return this;
    }
    if (!values.includes(s)) this.error(field, `${label}ไม่ถูกต้อง`);
    this.data[field] = s;
    return this;
  }

  bool(field) {
    const v = this.raw(field);
    this.data[field] = v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
    return this;
  }

  // รับค่าเป็นอาร์เรย์ของจำนวนเต็ม (เช่น checkbox หลายตัว)
  intList(field) {
    let v = this.input[field];
    if (v === undefined || v === null || v === '') v = [];
    if (!Array.isArray(v)) v = [v];
    const out = [];
    for (const item of v) {
      const s = String(item).trim();
      if (/^\d+$/.test(s)) out.push(parseInt(s, 10));
    }
    this.data[field] = [...new Set(out)];
    return this;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  // ถ้ามีข้อผิดพลาดให้โยน Error 422 พร้อมรายการ field ที่ผิด
  done() {
    if (!this.ok) throw validation(this.errors);
    return this.data;
  }
}

// นโยบายรหัสผ่าน: อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข
function checkPasswordPolicy(v, field, password, label = 'รหัสผ่าน') {
  if (!password) return v.error(field, `กรุณากรอก${label}`);
  if (password.length < 8 || password.length > 72) return v.error(field, `${label}ต้องยาว 8–72 ตัวอักษร`);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return v.error(field, `${label}ต้องมีทั้งตัวอักษรและตัวเลข`);
  }
  return v;
}

module.exports = { Validator, checkPasswordPolicy };
