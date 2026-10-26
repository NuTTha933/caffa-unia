const express = require('express');
const userService = require('../../services/userService');

const router = express.Router();

router.get('/', async (req, res) => {
  res.render('app/profile', {
    title: 'ข้อมูลของฉัน',
    profile: await userService.get(req.user.id),
    errors: {},
  });
});

router.post('/password', async (req, res) => {
  try {
    await userService.changeOwnPassword(req, req.body);
    req.flash('success', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
    res.redirect('/app/profile');
  } catch (err) {
    if (err.status === 422) {
      return res.status(422).render('app/profile', {
        title: 'ข้อมูลของฉัน', profile: await userService.get(req.user.id), errors: err.errors,
      });
    }
    throw err;
  }
});

module.exports = router;
