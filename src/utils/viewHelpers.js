const fmt = require('./format');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function chip(tone, label, extraClass = '') {
  return `<span class="chip chip--${tone}${extraClass ? ` ${extraClass}` : ''}">${esc(label)}</span>`;
}

module.exports = {
  esc,
  err: (errors, field) => (errors && errors[field]) || '',
  val: (values, field, fallback = '') => {
    if (!values) return fallback;
    const v = values[field];
    return v === undefined || v === null ? fallback : v;
  },
  nested: (values, group, key, fallback = '') => {
    if (!values || !values[group] || typeof values[group] !== 'object') return fallback;
    const v = values[group][key];
    return v === undefined || v === null ? fallback : v;
  },
  orderChip(status) {
    const s = fmt.ORDER_STATUS[status] || { label: status, tone: 'done' };
    return chip(s.tone, s.label, `chip--s-${status}`);
  },
  availabilityChip(available) {
    return available ? '' : chip('danger', 'หมด', 'chip--soldout');
  },
  resultChip(result) {
    const s = { success: ['ok', 'สำเร็จ'], failure: ['warn', 'ล้มเหลว'], denied: ['danger', 'ถูกปฏิเสธ'] }[result] || ['done', result];
    return chip(s[0], s[1]);
  },
  navActive(path, href, exact = false) {
    if (exact) return path === href;
    return path === href || path.startsWith(`${href}/`);
  },
  steps(status) {
    const order = ['pending', 'accepted', 'brewing', 'ready', 'completed'];
    const idx = order.indexOf(status);
    return fmt.ORDER_STEPS.map((s, i) => ({
      ...s,
      state: idx < 0 ? (i === 0 ? 'done' : 'todo') : i < idx ? 'done' : i === idx ? (status === 'completed' ? 'done' : 'current') : 'todo',
    }));
  },
  logDetails(details) {
    if (!details || typeof details !== 'object') return '';
    return Object.entries(details).map(([k, v]) => {
      const text = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `<div><span class="k">${esc(k)}</span> ${esc(text)}</div>`;
    }).join('');
  },
  pct(a, b) {
    return b > 0 ? Math.round((a / b) * 100) : 0;
  },
};
