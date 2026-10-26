const express = require('express');
const auditService = require('../../services/auditService');
const userService = require('../../services/userService');
const { authorize } = require('../../middleware/acl');
const { pageParam } = require('../helpers');
const fmt = require('../../utils/format');

const router = express.Router();

function readFilters(req) {
  const q = req.query;
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const userId = /^\d+$/.test(String(q.user_id || '')) ? Number(q.user_id) : '';
  return {
    from: date(q.from),
    to: date(q.to),
    user_id: userId,
    username: String(q.username || '').trim().slice(0, 50),
    category: Object.keys(fmt.LOG_CATEGORIES).includes(q.category) ? q.category : '',
    action: String(q.action || '').trim().slice(0, 60),
    result: ['success', 'failure', 'denied'].includes(q.result) ? q.result : '',
    q: String(q.q || '').trim().slice(0, 100),
  };
}

const toServiceFilter = (f) => ({ ...f, userId: f.user_id || null });

router.get('/', authorize('log.view', 'log.view_all'), async (req, res) => {
  const viewAll = req.can('log.view_all');
  const allowedCategories = auditService.categoriesFor(viewAll);
  const filters = readFilters(req);
  if (filters.category && !allowedCategories.includes(filters.category)) filters.category = '';
  const result = await auditService.search(toServiceFilter(filters), {
    allowedCategories: viewAll ? null : allowedCategories,
    page: pageParam(req),
  });
  res.render('app/logs/list', {
    title: 'Log การใช้งาน',
    result,
    filters,
    viewAll,
    categories: allowedCategories,
    users: await userService.listForFilter(),
    actions: await auditService.distinctActions(viewAll ? null : allowedCategories),
  });
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

router.get('/export.csv', authorize('log.view_all'), async (req, res) => {
  const filters = readFilters(req);
  const rows = await auditService.exportRows(toServiceFilter(filters));
  const header = ['id', 'datetime', 'username', 'role', 'category', 'action', 'result', 'resource_type', 'resource_id', 'method', 'path', 'ip', 'details'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.id, fmt.dateTime(r.created_at, true), r.username, r.role_code, r.category, r.action, r.result,
      r.resource_type, r.resource_id, r.method, r.path, r.ip, r.details,
    ].map(csvCell).join(','));
  }
  await auditService.audit(req, { category: 'admin', action: 'log.export', details: { rows: rows.length, filters } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="audit-logs-${fmt.todayISO()}.csv"`);
  res.send(`﻿${lines.join('\r\n')}`);
});

module.exports = router;
