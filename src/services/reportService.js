// รายงานยอดขาย (ฟังก์ชัน report.sales — ใช้สาธิตการเพิ่ม Permission ใหม่ผ่านเว็บ)
// ยอดขาย = ออเดอร์ที่ร้านรับเงินแล้ว (รอชง/กำลังชง/พร้อมรับ/รับแล้ว) ตัวเลขทั้งหมดคำนวณจากฐานข้อมูลจริง
const db = require('../db');

const PAID = `o.status IN ('accepted','brewing','ready','completed')`;

async function sales() {
  const today = (await db.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue,
            COALESCE(SUM((SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id = o.id)),0) AS cups
       FROM orders o WHERE ${PAID} AND o.created_at >= date_trunc('day', now())`,
  )).rows[0];

  const daily = (await db.query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(o.total_amount), 0) AS revenue, COUNT(o.id) AS orders
       FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
       LEFT JOIN orders o ON ${PAID} AND o.created_at >= d AND o.created_at < d + interval '1 day'
      GROUP BY d ORDER BY d`,
  )).rows;

  const week = (await db.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_amount),0) AS revenue,
            COALESCE(ROUND(AVG(o.total_amount), 2), 0) AS avg_ticket
       FROM orders o WHERE ${PAID} AND o.created_at >= date_trunc('day', now()) - interval '6 days'`,
  )).rows[0];

  const topItems = (await db.query(
    `SELECT m.code, i.item_name, SUM(i.quantity) AS cups, SUM(i.line_total) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN menu_items m ON m.id = i.menu_item_id
      WHERE ${PAID} AND o.created_at >= date_trunc('day', now()) - interval '29 days'
      GROUP BY m.code, i.item_name ORDER BY cups DESC, revenue DESC LIMIT 6`,
  )).rows;

  const byStatus = (await db.query(
    `SELECT o.status, COUNT(*) AS n FROM orders o
      WHERE o.created_at >= date_trunc('day', now()) - interval '6 days' GROUP BY o.status`,
  )).rows;

  const review = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
            COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL) AS reviewed,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - brewing_at)) / 60) FILTER (WHERE ready_at IS NOT NULL)), 0) AS avg_brew_min
       FROM orders WHERE created_at >= date_trunc('day', now()) - interval '6 days'`,
  )).rows[0];

  return { today, daily, week, topItems, byStatus, review };
}

module.exports = { sales };
