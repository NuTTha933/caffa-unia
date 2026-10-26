const express = require('express');
const fileService = require('../../services/fileService');
const orderService = require('../../services/orderService');
const { audit } = require('../../services/auditService');
const { authorize } = require('../../middleware/acl');
const { withFlashBack } = require('../helpers');

const router = express.Router();

async function sendFile(req, res, { download }) {
  const file = await fileService.getFile(req.params.id);
  await orderService.assertCanViewFile(req.user, file);

  if (download || file.kind === 'payment_slip') {
    await audit(req, {
      category: 'file', action: download ? 'file.download' : 'file.view',
      resourceType: file.order_id ? 'order' : 'menu',
      resourceId: file.order_id || file.menu_item_id,
      details: { file_id: file.id, kind: file.kind, original_name: file.original_name },
    });
  }

  const fullPath = fileService.storedPath(file.stored_name);
  res.removeHeader('Content-Security-Policy');
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (download) {
    return res.download(fullPath, file.original_name, { headers: { 'Content-Type': file.mime_type } });
  }
  res.set('Content-Type', file.mime_type);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  return res.sendFile(fullPath);
}

router.get('/:id', authorize('slip.view', 'menu.view'), (req, res) => sendFile(req, res, { download: false }));
router.get('/:id/download', authorize('slip.view', 'menu.view'), (req, res) => sendFile(req, res, { download: true }));

router.post('/:id/delete', authorize('slip.delete'), withFlashBack(async (req, res) => {
  const orderId = await orderService.deleteSlip(req, req.params.id);
  req.flash('success', 'ลบสลิปแล้ว — แนบสลิปใหม่ได้ก่อนร้านตรวจ');
  res.redirect(`/app/orders/${orderId}`);
}, '/app/orders'));

module.exports = router;
