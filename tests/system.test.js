// =====================================================================
//  ทดสอบระบบแบบ End-to-End กับฐานข้อมูลทดสอบจริง (PostgreSQL)
//  รัน: npm test   (ใช้ฐานข้อมูล <DB_NAME>_test แยกจากข้อมูลจริง และรีเซ็ตทุกครั้ง)
// =====================================================================
process.env.NODE_ENV = 'test';
require('dotenv').config({ quiet: true });
process.env.DB_NAME = `${process.env.DB_NAME || 'kernel_coffee'}_test`;
process.env.UPLOAD_DIR = 'storage/test-uploads';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');

// รีเซ็ตฐานข้อมูลทดสอบด้วยสคริปต์เดียวกับที่ใช้ติดตั้งจริง
const setup = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'db-setup.js')], {
  env: process.env, encoding: 'utf8',
});
if (setup.status !== 0) throw new Error(`db-setup failed: ${setup.stderr || setup.stdout}`);

const db = require('../src/db');
const { syncFunctions } = require('../src/acl/functions');
const { createApp } = require('../src/app');

let app;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const csrfFrom = (html) => (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];

async function login(username, password) {
  const agent = request.agent(app);
  const page = await agent.get('/login');
  const res = await agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), username, password });
  assert.equal(res.status, 302, `login ${username} ควร redirect`);
  const home = await agent.get('/app');
  agent.csrf = csrfFrom(home.text);
  return agent;
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const logCount = async (action, extra = '') => (await one(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = $1 ${extra}`, [action])).n;
const menuId = async (code) => (await one('SELECT id FROM menu_items WHERE code=$1', [code])).id;
const statusOf = async (id) => (await one('SELECT status FROM orders WHERE id=$1', [id])).status;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048, 0x20), Buffer.from('\n%%EOF')]);

before(async () => {
  await syncFunctions(db);
  app = createApp();
});

after(async () => {
  await db.pool.end();
});

// ---------------------------------------------------------------------
test('1. Authentication: รหัสผ่านเก็บเป็น bcrypt hash, เข้าสู่ระบบสำเร็จ/ล้มเหลว และบันทึก Log', async () => {
  const users = (await db.query('SELECT username, password_hash FROM users')).rows;
  assert.equal(users.length, 6);
  for (const u of users) {
    assert.match(u.password_hash, /^\$2[aby]\$12\$/, 'ต้องเป็น bcrypt cost 12 (มี salt ในตัว)');
    assert.ok(!u.password_hash.includes('@1234'));
  }

  const agent = request.agent(app);
  const page = await agent.get('/login');
  const bad = await agent.post('/login').type('form')
    .send({ _csrf: csrfFrom(page.text), username: 'customer1', password: 'WrongPass#999' });
  assert.equal(bad.status, 401);
  assert.match(bad.text, /ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง/);
  assert.equal(await logCount('login_failed', `AND username = 'customer1'`), 1);

  await login('customer1', 'Customer@1234');
  assert.ok(await logCount('login_success', `AND username = 'customer1'`) >= 1);

  const leaked = await one(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE details::text ILIKE '%WrongPass%' OR details::text ILIKE '%Customer@1234%'`,
  );
  assert.equal(leaked.n, 0, 'Log ต้องไม่มีรหัสผ่าน');
});

test('2. ยังไม่เข้าสู่ระบบ → หน้าเว็บ redirect ไป /login, API ตอบ 401', async () => {
  const page = await request(app).get('/app/orders');
  assert.equal(page.status, 302);
  assert.match(page.headers.location, /^\/login\?next=/);
  assert.equal((await request(app).get('/api/orders')).status, 401);
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
  assert.equal((await request(app).get('/admin')).status, 302);
});

test('3. ออกจากระบบแล้ว cookie เดิมใช้ต่อไม่ได้ (Session ถูกลบฝั่ง Server)', async () => {
  const agent = await login('customer2', 'Customer@1234');
  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);
  const oldCookie = me.req.getHeader('cookie');
  const out = await agent.post('/logout').type('form').send({ _csrf: agent.csrf });
  assert.equal(out.status, 302);
  const reuse = await request(app).get('/api/me').set('Cookie', oldCookie);
  assert.equal(reuse.status, 401);
  assert.ok(await logCount('logout') >= 1);
});

test('4. สิทธิ์ 4 Role แตกต่างกัน และส่วน Admin ถูกปฏิเสธทั้งหน้าเว็บและ API', async () => {
  const customer = await login('customer1', 'Customer@1234');
  const manager = await login('manager1', 'Manager@1234');
  const barista = await login('barista1', 'Barista@1234');
  const admin = await login('admin', 'Admin@1234');

  for (const a of [customer, manager, barista]) {
    assert.equal((await a.get('/admin/users')).status, 403);
    assert.equal((await a.get('/admin/acl')).status, 403);
    const api = await a.get('/api/admin/users');
    assert.equal(api.status, 403);
    assert.equal(api.body.error, 'forbidden');
  }
  assert.equal((await admin.get('/admin/acl')).status, 200);
  assert.equal((await admin.get('/api/admin/users')).status, 200);

  // ความแตกต่างของสิทธิ์งาน
  assert.equal((await customer.get('/app/orders/new')).status, 200);
  assert.equal((await manager.get('/app/orders/new')).status, 403, 'ผู้จัดการไม่ได้สั่งเครื่องดื่ม');
  assert.equal((await barista.get('/app/queue')).status, 200);
  assert.equal((await customer.get('/app/queue')).status, 403);
  assert.equal((await manager.get('/app/menu/new')).status, 200);
  assert.equal((await barista.get('/app/menu/new')).status, 403, 'บาริสต้าปิดเมนูหมดได้ แต่เพิ่มเมนูไม่ได้');
  assert.equal((await manager.get('/app/logs')).status, 200);
  assert.equal((await barista.get('/app/logs')).status, 403);
  assert.equal((await manager.get('/app/logs/export.csv')).status, 403, 'ผู้จัดการดู Log ได้ตามกำหนด แต่ส่งออกไม่ได้');
  assert.equal((await manager.get('/app/reports')).status, 403, 'รายงานยังไม่ถูกกำหนดให้ Role ใด');
  assert.equal((await admin.get('/app/reports')).status, 200, 'Admin ใช้ได้ทุกฟังก์ชัน');

  // API ไม่คืน password_hash
  const users = await admin.get('/api/admin/users');
  assert.ok(!JSON.stringify(users.body).includes('password'));
  assert.ok(await logCount('access_denied') >= 9);
});

test('5. กระบวนการหลัก: สั่ง → แนบสลิป → ตรวจสลิป → เริ่มชง → พร้อมรับ → ส่งมอบ', async () => {
  const customer = await login('customer1', 'Customer@1234');
  const manager = await login('manager1', 'Manager@1234');
  const barista = await login('barista1', 'Barista@1234');
  const latte = await menuId('CF-03');
  const croissant = await menuId('BK-01');
  const soldOut = await menuId('TE-03');

  // ตรวจข้อมูลฝั่ง Server
  const empty = await customer.post('/app/orders').type('form').send({ _csrf: customer.csrf });
  assert.equal(empty.status, 422);
  assert.match(empty.text, /กรุณาเลือกอย่างน้อย 1 รายการ/);
  const outOfStock = await customer.post('/app/orders').type('form').send({ _csrf: customer.csrf, [`qty[m${soldOut}]`]: '1' });
  assert.equal(outOfStock.status, 422);
  assert.match(outOfStock.text, /หมดชั่วคราว/);
  const tooMany = await customer.post('/app/orders').type('form').send({ _csrf: customer.csrf, [`qty[m${latte}]`]: '99' });
  assert.equal(tooMany.status, 422);

  // ราคาคิดจากฐานข้อมูล ไม่เชื่อค่าที่ Browser ส่งมา
  const created = await customer.post('/app/orders').type('form').send({
    _csrf: customer.csrf, [`qty[m${latte}]`]: '2', [`qty[m${croissant}]`]: '1',
    total_amount: '1', note: 'รับตอนบ่ายโมง',
  });
  assert.equal(created.status, 302);
  const id = Number(created.headers.location.split('/').pop());
  const order = await one('SELECT * FROM orders WHERE id=$1', [id]);
  assert.equal(order.status, 'pending');
  assert.equal(Number(order.total_amount), 75 * 2 + 65);
  const lines = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id])).rows;
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => l.menu_item_id === latte).quantity, 2);
  assert.equal(Number(lines.find((l) => l.menu_item_id === latte).unit_price), 75, 'เก็บราคา ณ เวลาที่สั่ง');

  // ยังไม่แนบสลิป → ผู้จัดการรับออเดอร์ไม่ได้ (Server ตรวจเอง)
  const early = await manager.post(`/app/orders/${id}/accept`).type('form').send({ _csrf: manager.csrf });
  assert.equal(early.status, 302);
  assert.equal(await statusOf(id), 'pending');
  assert.match((await manager.get(`/app/orders/${id}`)).text, /ยังไม่ได้แนบสลิป/);

  const slip = await customer.post(`/app/orders/${id}/slip?_csrf=${customer.csrf}`)
    .attach('slip', PNG, { filename: 'สลิป.png', contentType: 'image/png' });
  assert.equal(slip.status, 302);

  // บาริสต้าตรวจสลิปไม่ได้, ลูกค้าเริ่มชงเองไม่ได้
  assert.equal((await barista.post(`/app/orders/${id}/accept`).type('form').send({ _csrf: barista.csrf })).status, 403);
  assert.equal((await customer.post(`/app/orders/${id}/brew`).type('form').send({ _csrf: customer.csrf })).status, 403);
  // ก่อนรับออเดอร์ บาริสต้ายังมองไม่เห็น (ไม่อยู่ในคิว)
  assert.equal((await barista.get(`/app/orders/${id}`)).status, 403);

  assert.equal((await manager.post(`/app/orders/${id}/accept`).type('form').send({ _csrf: manager.csrf })).status, 302);
  assert.equal(await statusOf(id), 'accepted');
  assert.equal((await barista.get(`/app/orders/${id}`)).status, 200, 'รับออเดอร์แล้วเข้าคิวบาร์');
  assert.match((await barista.get('/app/queue')).text, new RegExp(`K-${String(id).padStart(4, '0')}`));

  for (const [step, expected] of [['brew', 'brewing'], ['ready', 'ready'], ['complete', 'completed']]) {
    const r = await barista.post(`/app/orders/${id}/${step}`).type('form').send({ _csrf: barista.csrf, back: 'queue' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/app/queue');
    assert.equal(await statusOf(id), expected);
  }
  // ทำซ้ำขั้นเดิมไม่ได้
  await barista.post(`/app/orders/${id}/complete`).type('form').send({ _csrf: barista.csrf });
  assert.equal(await statusOf(id), 'completed');

  const api = await customer.get(`/api/orders/${id}`);
  assert.equal(api.body.data.status, 'completed');
  assert.equal(api.body.data.history.length, 5);
  for (const a of ['order.create', 'order.accept', 'order.brew', 'order.ready', 'order.complete']) {
    assert.equal(await logCount(a, `AND resource_id = '${id}'`), 1, `ต้องมี Log ${a}`);
  }
});

test('6. ปฏิเสธสลิปต้องมีเหตุผล และลูกค้ายกเลิกได้เฉพาะออเดอร์ของตนก่อนตรวจ', async () => {
  const manager = await login('manager1', 'Manager@1234');
  const customer1 = await login('customer1', 'Customer@1234');
  const customer2 = await login('customer2', 'Customer@1234');
  const pending4 = await one(`SELECT o.id FROM orders o JOIN users u ON u.id=o.customer_id
                               WHERE u.username='customer2' AND o.status='pending' LIMIT 1`);

  await manager.post(`/app/orders/${pending4.id}/reject`).type('form').send({ _csrf: manager.csrf, note: '' });
  assert.equal(await statusOf(pending4.id), 'pending', 'ไม่มีเหตุผล → ไม่บันทึก');

  // customer1 ยกเลิกออเดอร์ของ customer2 ไม่ได้
  assert.equal((await customer1.post(`/app/orders/${pending4.id}/cancel`).type('form').send({ _csrf: customer1.csrf })).status, 403);
  assert.equal(await statusOf(pending4.id), 'pending');

  const cancel = await customer2.post(`/app/orders/${pending4.id}/cancel`).type('form').send({ _csrf: customer2.csrf });
  assert.equal(cancel.status, 302);
  assert.equal(await statusOf(pending4.id), 'cancelled');

  // สร้างออเดอร์ใหม่แล้วให้ผู้จัดการปฏิเสธพร้อมเหตุผล
  const created = await customer2.post('/app/orders').type('form').send({ _csrf: customer2.csrf, [`qty[m${await menuId('MK-01')}]`]: '1' });
  const id = Number(created.headers.location.split('/').pop());
  await manager.post(`/app/orders/${id}/reject`).type('form').send({ _csrf: manager.csrf, note: 'ยอดโอนไม่ตรง' });
  assert.equal(await statusOf(id), 'rejected');
  const page = await customer2.get(`/app/orders/${id}`);
  assert.match(page.text, /ยอดโอนไม่ตรง/);
  assert.ok(await logCount('order.reject') >= 1);
  assert.ok(await logCount('order.cancel') >= 1);
});

test('7. เงื่อนไขเจ้าของข้อมูล: ลูกค้าดูออเดอร์ของคนอื่นไม่ได้ / บาริสต้าเห็นเฉพาะคิวที่ชำระแล้ว', async () => {
  const customer2 = await login('customer2', 'Customer@1234');
  const barista = await login('barista1', 'Barista@1234');
  const pendingOf1 = await one(`SELECT o.id FROM orders o JOIN users u ON u.id=o.customer_id
                                 WHERE u.username='customer1' AND o.status='pending' LIMIT 1`);
  assert.equal((await customer2.get(`/app/orders/${pendingOf1.id}`)).status, 403);
  assert.equal((await customer2.get(`/api/orders/${pendingOf1.id}`)).status, 403);
  assert.equal((await barista.get(`/app/orders/${pendingOf1.id}`)).status, 403, 'ยังไม่ชำระ ไม่อยู่ในคิวของบาริสต้า');
  const list = await customer2.get('/api/orders');
  assert.ok(list.body.data.length > 0);
  assert.ok(list.body.data.every((o) => o.customer.username === 'customer2'));
  const queue = await barista.get('/api/orders');
  assert.ok(queue.body.data.every((o) => ['accepted', 'brewing', 'ready', 'completed'].includes(o.status)));
});

test('8. อัปโหลดไฟล์: ถูกต้อง/ผิดชนิด/เกินขนาด และการเปิดไฟล์ตามสิทธิ์', async () => {
  const customer1 = await login('customer1', 'Customer@1234');
  const customer2 = await login('customer2', 'Customer@1234');
  const manager = await login('manager1', 'Manager@1234');
  const barista = await login('barista1', 'Barista@1234');
  const created = await customer1.post('/app/orders').type('form').send({ _csrf: customer1.csrf, [`qty[m${await menuId('CF-01')}]`]: '1' });
  const id = Number(created.headers.location.split('/').pop());
  const url = `/app/orders/${id}/slip?_csrf=${customer1.csrf}`;
  const rejectedBefore = await logCount('file.upload_rejected');

  const ok = await customer1.post(url).attach('slip', PDF, { filename: 'สลิปโอนเงิน.pdf', contentType: 'application/pdf' });
  assert.equal(ok.status, 302);
  const file = await one(`SELECT * FROM files WHERE order_id=$1 AND kind='payment_slip'`, [id]);
  assert.equal(file.original_name, 'สลิปโอนเงิน.pdf');
  assert.equal(file.mime_type, 'application/pdf');
  assert.equal(file.uploaded_by, (await one(`SELECT id FROM users WHERE username='customer1'`)).id);
  assert.match(file.stored_name, /^[0-9a-f-]{36}\.pdf$/, 'ชื่อไฟล์จัดเก็บเป็น UUID ไม่ชนกัน');

  // ไฟล์ข้อความที่ตั้งชื่อ .jpg → ตรวจจากเนื้อไฟล์แล้วปฏิเสธ, ไฟล์เกิน 3 MB → ปฏิเสธ
  const fake = await customer1.post(url).attach('slip', Buffer.from('MZ this is not an image at all......'), { filename: 'slip.jpg', contentType: 'image/jpeg' });
  assert.equal(fake.status, 302);
  const big = await customer1.post(url).attach('slip', Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' });
  assert.equal(big.status, 302);
  assert.equal((await one('SELECT COUNT(*) AS n FROM files WHERE order_id=$1', [id])).n, 1, 'สลิปเดิมยังอยู่');
  assert.equal(await logCount('file.upload_rejected') - rejectedBefore, 2);
  assert.match((await customer1.get(`/app/orders/${id}`)).text, /เกินกำหนด|ชนิดไฟล์ไม่ได้รับอนุญาต/);

  // customer2 แนบสลิปในออเดอร์ของ customer1 ไม่ได้
  assert.equal((await customer2.post(`/app/orders/${id}/slip?_csrf=${customer2.csrf}`).attach('slip', PNG, { filename: 'x.png', contentType: 'image/png' })).status, 403);

  // เปิด/ดาวน์โหลดตามสิทธิ์
  const own = await customer1.get(`/app/files/${file.id}`);
  assert.equal(own.status, 200);
  assert.equal(own.headers['content-type'], 'application/pdf');
  assert.equal((await manager.get(`/app/files/${file.id}/download`)).status, 200);
  assert.equal((await customer2.get(`/app/files/${file.id}`)).status, 403);
  assert.equal((await customer2.get(`/api/files/${file.id}`)).status, 403);
  assert.equal((await barista.get(`/app/files/${file.id}`)).status, 403, 'บาริสต้าไม่มีสิทธิ์ดูสลิป');
  assert.equal((await request(app).get(`/app/files/${file.id}`)).status, 302, 'ไม่มี URL สาธารณะ');
  assert.equal((await request(app).get(`/storage/uploads/${file.stored_name}`)).status, 404, 'โฟลเดอร์เก็บไฟล์ไม่ถูกเปิดเป็น static');
  assert.ok(await logCount('file.access_denied') >= 3);

  // ลบสลิปของตนเองขณะรอตรวจได้ แล้วแนบใหม่ได้
  assert.equal((await customer2.post(`/app/files/${file.id}/delete`).type('form').send({ _csrf: customer2.csrf })).status, 403);
  assert.equal((await customer1.post(`/app/files/${file.id}/delete`).type('form').send({ _csrf: customer1.csrf })).status, 302);
  assert.equal((await one('SELECT COUNT(*) AS n FROM files WHERE order_id=$1', [id])).n, 0);
  assert.ok(await logCount('file.delete') >= 1);

  // ภาพเมนู (ผู้จัดการ): PNG ผ่าน, GIF ไม่ผ่าน; บาริสต้าอัปโหลดไม่ได้แต่เปิดดูได้
  const menu = await menuId('CF-04');
  const img = await manager.post(`/app/menu/${menu}/image?_csrf=${manager.csrf}`).attach('image', PNG, { filename: 'cappuccino.png', contentType: 'image/png' });
  assert.equal(img.status, 302);
  const gif = await manager.post(`/app/menu/${menu}/image?_csrf=${manager.csrf}`).attach('image', Buffer.from('GIF89a..........'), { filename: 'a.png', contentType: 'image/png' });
  assert.equal(gif.status, 302);
  const imgRow = await one(`SELECT * FROM files WHERE menu_item_id=$1`, [menu]);
  assert.equal(imgRow.original_name, 'cappuccino.png');
  assert.equal((await barista.post(`/app/menu/${menu}/image?_csrf=${barista.csrf}`).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' })).status, 403);
  assert.equal((await barista.get(`/app/files/${imgRow.id}`)).status, 200);
});

test('9. บาริสต้าปิดเมนูที่หมด → ลูกค้าสั่งเมนูนั้นไม่ได้', async () => {
  const barista = await login('barista1', 'Barista@1234');
  const customer = await login('customer1', 'Customer@1234');
  const mocha = await menuId('CF-05');
  const off = await barista.post(`/app/menu/${mocha}/availability`).type('form').send({ _csrf: barista.csrf, available: '0' });
  assert.equal(off.status, 302);
  const res = await customer.post('/app/orders').type('form').send({ _csrf: customer.csrf, [`qty[m${mocha}]`]: '1' });
  assert.equal(res.status, 422);
  assert.equal(await logCount('menu.sold_out'), 1);
  await barista.post(`/app/menu/${mocha}/availability`).type('form').send({ _csrf: barista.csrf, available: '1' });
  assert.equal((await one('SELECT is_available FROM menu_items WHERE id=$1', [mocha])).is_available, true);
});

test('10. Admin เพิ่ม Role ใหม่ผ่านเว็บและกำหนดให้บัญชีทดสอบ', async () => {
  const admin = await login('admin', 'Admin@1234');
  const res = await admin.post('/admin/roles').type('form').send({
    _csrf: admin.csrf, code: 'accountant', name: 'ฝ่ายบัญชี', description: 'ดูรายงานยอดขาย', copy_from: '',
  });
  assert.equal(res.status, 302);
  const role = await one(`SELECT * FROM roles WHERE code='accountant'`);
  const tester = await one(`SELECT * FROM users WHERE username='tester'`);
  const upd = await admin.post(`/admin/users/${tester.id}/edit`).type('form').send({
    _csrf: admin.csrf, full_name: tester.full_name, email: tester.email, phone: '', role_id: role.id, is_active: '1',
  });
  assert.equal(upd.status, 302);
  assert.equal(await logCount('role.create'), 1);
  assert.equal(await logCount('user.role_change'), 1);

  const t = await login('tester', 'Tester@1234');
  const me = await t.get('/api/me');
  assert.equal(me.body.role.code, 'accountant');
  assert.deepEqual(me.body.functions, []);
  assert.equal((await t.get('/app/orders')).status, 403);
});

test('11. เพิ่ม Permission ผ่านเว็บ เชื่อมฟังก์ชัน กำหนดให้ Role → ใช้ได้ทันที / ยกเลิก → ถูกปฏิเสธทันที (ไม่เริ่ม Server ใหม่)', async () => {
  const admin = await login('admin', 'Admin@1234');
  const tester = await login('tester', 'Tester@1234');
  const role = await one(`SELECT id FROM roles WHERE code='accountant'`);
  const fn = await one(`SELECT id FROM app_functions WHERE code='report.sales'`);

  assert.equal((await tester.get('/app/reports')).status, 403);

  // Permission ที่ยังไม่เชื่อมฟังก์ชัน ไม่เปิดสิทธิ์อะไร
  await admin.post('/admin/permissions').type('form').send({ _csrf: admin.csrf, code: 'report.dummy', name: 'ยังไม่เชื่อม' });
  const dummy = await one(`SELECT id FROM permissions WHERE code='report.dummy'`);
  const created = await admin.post('/admin/permissions').type('form').send({
    _csrf: admin.csrf, code: 'report.view', name: 'ดูรายงานยอดขาย', function_ids: [String(fn.id)],
  });
  assert.equal(created.status, 302);
  const perm = await one(`SELECT id FROM permissions WHERE code='report.view'`);

  const current = (await db.query('SELECT role_id, permission_id FROM role_permissions')).rows.map((g) => `${g.role_id}:${g.permission_id}`);
  const withDummy = [...current, `${role.id}:${dummy.id}`];
  assert.equal((await admin.post('/admin/acl').type('form').send({ _csrf: admin.csrf, grant: withDummy })).status, 302);
  assert.equal((await tester.get('/app/reports')).status, 403, 'มีแค่ชื่อ Permission แต่ไม่เชื่อมฟังก์ชัน → ยังเข้าไม่ได้');

  await admin.post('/admin/acl').type('form').send({ _csrf: admin.csrf, grant: [...withDummy, `${role.id}:${perm.id}`] });
  assert.equal((await tester.get('/app/reports')).status, 200, 'ได้รับสิทธิ์แล้วใช้ได้ทันที (หน้าเว็บ)');
  assert.equal((await tester.get('/api/reports/sales')).status, 200, 'ได้รับสิทธิ์แล้วใช้ได้ทันที (API)');

  await admin.post('/admin/acl').type('form').send({ _csrf: admin.csrf, grant: withDummy });
  assert.equal((await tester.get('/app/reports')).status, 403, 'ยกเลิกแล้วถูกปฏิเสธทันที (หน้าเว็บ)');
  assert.equal((await tester.get('/api/reports/sales')).status, 403, 'ยกเลิกแล้วถูกปฏิเสธทันที (API)');

  assert.equal(await logCount('permission.create'), 2);
  assert.ok(await logCount('acl.grant') >= 2);
  assert.equal(await logCount('acl.revoke'), 1);

  const api = await admin.put('/api/admin/acl').send({ role_id: role.id, permission_id: perm.id, granted: true });
  assert.equal(api.status, 200);
  assert.equal((await tester.get('/api/reports/sales')).status, 200);
});

test('12. ป้องกันการลบ Role ที่ยังมีผู้ใช้ และป้องกันไม่ให้ไม่มี Admin เหลือ', async () => {
  const admin = await login('admin', 'Admin@1234');
  const accountant = await one(`SELECT id FROM roles WHERE code='accountant'`);
  const del = await admin.post(`/admin/roles/${accountant.id}/delete`).type('form').send({ _csrf: admin.csrf });
  assert.equal(del.status, 302);
  assert.ok(await one(`SELECT id FROM roles WHERE code='accountant'`), 'Role ยังต้องอยู่');
  assert.match((await admin.get('/admin/roles')).text, /ยังมีผู้ใช้ในบทบาท/);

  const customerRole = await one(`SELECT id FROM roles WHERE code='customer'`);
  const me = await one(`SELECT * FROM users WHERE username='admin'`);
  const demote = await admin.post(`/admin/users/${me.id}/edit`).type('form').send({
    _csrf: admin.csrf, full_name: me.full_name, email: me.email, phone: me.phone, role_id: customerRole.id, is_active: '1',
  });
  assert.equal(demote.status, 409);
  assert.match(demote.text, /ต้องมีผู้ดูแลระบบ/);
  assert.equal((await one(`SELECT r.code FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username='admin'`)).code, 'admin');

  assert.equal((await admin.delete(`/api/admin/roles/${customerRole.id}`).set('Content-Type', 'application/json')).status, 409);
  assert.equal((await admin.delete(`/api/admin/roles/${customerRole.id}`)).status, 403, 'API ที่เปลี่ยนข้อมูลต้องส่ง JSON หรือ CSRF token');
});

test('13. Log: กรองดูย้อนหลังได้ จำกัดสิทธิ์ดู และไม่เก็บข้อมูลลับ', async () => {
  const admin = await login('admin', 'Admin@1234');
  const manager = await login('manager1', 'Manager@1234');

  const acl = await admin.get('/app/logs?category=admin&action=acl.grant');
  assert.equal(acl.status, 200);
  assert.match(acl.text, /acl\.grant/);
  const denied = await admin.get('/api/logs?result=denied');
  assert.ok(denied.body.total > 0);
  assert.ok(denied.body.data.every((l) => l.result === 'denied'));
  const byDate = await admin.get(`/api/logs?from=${today}&to=${today}&category=file`);
  assert.ok(byDate.body.data.some((l) => l.action === 'file.upload'));
  const byUser = await admin.get(`/api/logs?user_id=${(await one(`SELECT id FROM users WHERE username='barista1'`)).id}`);
  assert.ok(byUser.body.data.length > 0 && byUser.body.data.every((l) => l.username === 'barista1'));

  // ผู้จัดการเห็นเฉพาะหมวดงาน ไม่เห็น auth/admin
  const mgr = await manager.get('/api/logs?category=auth');
  assert.ok(mgr.body.data.every((l) => ['order', 'menu', 'file'].includes(l.category)));

  const csv = await admin.get('/app/logs/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);

  const secrets = await one(
    `SELECT COUNT(*) AS n FROM audit_logs
      WHERE details::text ~* '(Admin@1234|Manager@1234|Barista@1234|Customer@1234|Tester@1234|\\$2b\\$|"_csrf"|"password")'`,
  );
  assert.equal(secrets.n, 0, 'ไม่มีรหัสผ่าน hash หรือ token ใน Log');
  const sessions = (await db.query('SELECT sid FROM user_sessions')).rows.map((r) => r.sid);
  const logs = (await db.query('SELECT COALESCE(details::text, \'\') || COALESCE(path, \'\') AS t FROM audit_logs')).rows.map((r) => r.t).join('\n');
  assert.ok(sessions.every((sid) => !logs.includes(sid)), 'ไม่มี Session ID ใน Log');
});

test('14. CSRF: ส่งฟอร์มเปลี่ยนแปลงข้อมูลโดยไม่มี token ถูกปฏิเสธ', async () => {
  const customer = await login('customer1', 'Customer@1234');
  const res = await customer.post('/app/orders').type('form').send({ 'qty[m1]': '1' });
  assert.equal(res.status, 403);
  assert.match(res.text, /แบบฟอร์มหมดอายุ|CSRF/);
});
