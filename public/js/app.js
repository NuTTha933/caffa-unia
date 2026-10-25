// สคริปต์ฝั่ง Browser (แยกไฟล์ ไม่ใช้ inline script เพื่อให้ผ่าน Content-Security-Policy)
// ช่วยให้ใช้งานสะดวกเท่านั้น — Server ตรวจข้อมูลและสิทธิ์ซ้ำทุกครั้ง
(function () {
  'use strict';

  // 1) เมนูนำทางบนมือถือ (เปิด/ปิด)
  var toggle = document.querySelector('.nav-toggle');
  var rail = document.getElementById('rail');
  if (toggle && rail) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      rail.classList.toggle('is-open', open);
    });
  }

  // 2) ปุ่มปิดข้อความแจ้งเตือน
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-dismiss]');
    if (btn) btn.parentElement.remove();
  });

  // 3) ยืนยันก่อนทำรายการที่ย้อนกลับไม่ได้ (ฟอร์มที่มี data-confirm)
  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // 4) หน้าเข้าสู่ระบบ: กดเลือกบัญชีทดสอบเพื่อกรอกให้
  document.querySelectorAll('[data-fill-user]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.getElementById('username').value = btn.getAttribute('data-fill-user');
      document.getElementById('password').value = btn.getAttribute('data-fill-pass');
    });
  });

  // 5) หน้า ACL: ไฮไลต์ช่องที่เปลี่ยนและนับจำนวนก่อนกดบันทึก
  var aclForm = document.getElementById('acl-form');
  if (aclForm) {
    var pending = document.getElementById('acl-pending');
    var update = function () {
      var added = 0;
      var removed = 0;
      aclForm.querySelectorAll('.acl-check').forEach(function (c) {
        var changed = c.checked !== (c.getAttribute('data-initial') === '1');
        c.closest('td').classList.toggle('changed', changed);
        if (changed && c.checked) added += 1;
        if (changed && !c.checked) removed += 1;
      });
      pending.textContent = added || removed
        ? 'รอบันทึก: กำหนดเพิ่ม ' + added + ' · ยกเลิก ' + removed + ' รายการ'
        : 'ยังไม่มีการเปลี่ยนแปลง';
    };
    aclForm.addEventListener('change', update);
    aclForm.addEventListener('reset', function () { setTimeout(update, 0); });
  }
})();
