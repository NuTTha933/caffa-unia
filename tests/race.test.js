process.env.NODE_ENV = 'test';
require('dotenv').config({ quiet: true });
process.env.DB_NAME = `${process.env.DB_NAME || 'Caffa_Unia'}_test`;
process.env.UPLOAD_DIR = 'storage/test-uploads';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');

const setup = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'db-setup.js')], {
  env: process.env, encoding: 'utf8',
});
if (setup.status !== 0) throw new Error(`db-setup failed: ${setup.stderr || setup.stdout}`);

const db = require('../src/db');
const { syncFunctions } = require('../src/acl/functions');
const { createApp } = require('../src/app');

const ROUNDS = 15;
let app;
const csrfFrom = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]);

async function login(username, password) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), username, password });
  assert.equal(res.status, 302, `login ${username} ควร redirect`);
  agent.csrf = csrfFrom((await agent.get('/app')).text);
  return agent;
}

const uploadSlip = (agent, orderId) => agent.post(`/app/orders/${orderId}/slip?_csrf=${agent.csrf}`)
  .attach('slip', PNG, { filename: 'slip.png', contentType: 'image/png' });

async function newOrder(customer, withSlip) {
  const menu = await one('SELECT id FROM menu_items WHERE is_available ORDER BY id LIMIT 1');
  const res = await customer.post('/app/orders').type('form').send({ _csrf: customer.csrf, [`qty[m${menu.id}]`]: '1' });
  assert.equal(res.status, 302);
  const id = Number(res.headers.location.split('/').pop());
  if (withSlip) assert.equal((await uploadSlip(customer, id)).status, 302);
  return id;
}

const slipCount = async (orderId) => (await one(
  `SELECT COUNT(*) AS n FROM files WHERE order_id=$1 AND kind='payment_slip'`, [orderId],
)).n;

before(async () => {
  await syncFunctions(db);
  app = createApp();
});

after(async () => {
  await db.pool.end();
});

test('A. ลูกค้ากดแนบสลิปซ้ำพร้อมกัน 2 ครั้ง: ออเดอร์ต้องเหลือสลิปเดียว (สลิปเก่าถูกแทนที่)', async () => {
  const customer = await login('customer1', 'Customer@1234');
  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newOrder(customer, true);
    await Promise.all([uploadSlip(customer, id), uploadSlip(customer, id)]);
    if ((await slipCount(id)) !== 1) bad += 1;
  }
  assert.equal(bad, 0, `พบออเดอร์ที่มีสลิปมากกว่า 1 ไฟล์ ${bad} จาก ${ROUNDS} รอบ`);
});

test('B. ลูกค้าลบสลิปพร้อมกับผู้จัดการกดรับออเดอร์: ห้ามมีออเดอร์ที่รับแล้วแต่ไม่มีสลิป', async () => {
  const customer = await login('customer1', 'Customer@1234');
  const manager = await login('manager1', 'Manager@1234');
  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newOrder(customer, true);
    const slip = await one(`SELECT id FROM files WHERE order_id=$1 AND kind='payment_slip'`, [id]);
    await Promise.all([
      manager.post(`/app/orders/${id}/accept`).type('form').send({ _csrf: manager.csrf }),
      customer.post(`/app/files/${slip.id}/delete`).type('form').send({ _csrf: customer.csrf }),
    ]);
    const { status } = await one('SELECT status FROM orders WHERE id=$1', [id]);
    if (status === 'accepted' && (await slipCount(id)) === 0) bad += 1;
  }
  assert.equal(bad, 0, `พบออเดอร์ที่รับแล้วแต่ไม่มีสลิป ${bad} จาก ${ROUNDS} รอบ`);
});

test('C. Admin 2 คนลดสิทธิ์กันเองพร้อมกัน: ระบบต้องเหลือ Admin ที่ใช้งานได้อย่างน้อย 1 คน', async () => {
  const adminRole = (await one(`SELECT id FROM roles WHERE is_admin ORDER BY id LIMIT 1`)).id;
  const customerRole = (await one(`SELECT id FROM roles WHERE code='customer'`)).id;
  await db.query(
    `INSERT INTO users (username, full_name, email, password_hash, role_id)
     SELECT 'admin2', 'ผู้ดูแลระบบสำรอง', 'admin2@caffaunia.example', password_hash, role_id FROM users WHERE username='admin'`,
  );
  const ids = Object.fromEntries((await db.query(`SELECT username, id FROM users WHERE username IN ('admin','admin2')`)).rows
    .map((r) => [r.username, r.id]));
  const demote = (agent, targetId, name) => agent.post(`/admin/users/${targetId}/edit`).type('form').send({
    _csrf: agent.csrf, full_name: name, email: '', phone: '', role_id: String(customerRole), is_active: 'on',
  });
  const activeAdmins = async () => (await one(
    `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.is_admin AND u.is_active`,
  )).n;

  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) {
    await db.query('UPDATE users SET role_id=$1, is_active=true WHERE id = ANY($2)', [adminRole, [ids.admin, ids.admin2]]);
    const a1 = await login('admin', 'Admin@1234');
    const a2 = await login('admin2', 'Admin@1234');
    await Promise.all([demote(a1, ids.admin2, 'ผู้ดูแลระบบสำรอง'), demote(a2, ids.admin, 'สมชาย ดูแลระบบ')]);
    if ((await activeAdmins()) < 1) bad += 1;
  }
  await db.query('UPDATE users SET role_id=$1, is_active=true WHERE id = ANY($2)', [adminRole, [ids.admin, ids.admin2]]);
  assert.equal(bad, 0, `ระบบไม่เหลือ Admin ${bad} จาก ${ROUNDS} รอบ`);
});

test('D. ยิงรหัสผ่านผิดพร้อมกัน 30 ครั้ง: ตรวจรหัสได้ไม่เกิน 8 ครั้ง ที่เหลือต้องถูกบล็อก (429)', async () => {
  const agents = [];
  for (let i = 0; i < 30; i++) {
    const agent = request.agent(app);
    agent.csrf = csrfFrom((await agent.get('/login')).text);
    agents.push(agent);
  }
  const results = await Promise.all(agents.map((a) => a.post('/login').type('form')
    .send({ _csrf: a.csrf, username: 'barista1', password: 'WrongPass#000' })));
  const checked = results.filter((r) => r.status === 401).length;
  const blocked = results.filter((r) => r.status === 429).length;
  assert.ok(checked <= 8, `ตรวจรหัสผ่านไป ${checked} ครั้ง (ควรไม่เกิน 8), ถูกบล็อก ${blocked} ครั้ง`);
  assert.equal(checked + blocked, 30);
});
