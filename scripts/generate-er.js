// =====================================================================
//  สร้าง ER Diagram จาก "ฐานข้อมูลจริง" (อ่าน information_schema / pg_catalog)
//  ผลลัพธ์: docs/er-diagram.dot (Graphviz) และ docs/er-diagram.mmd (Mermaid)
//  ใช้: npm run er   แล้วแปลงเป็นภาพ  dot -Tpng docs/er-diagram.dot -o docs/er-diagram-auto.png
//        (ตั้งชื่ออื่นเพื่อไม่ทับภาพหลัก docs/er-diagram.png ที่จัดเส้นไม่ให้ตัดกันแล้ว)
//        หรือวางไฟล์ .mmd ใน https://mermaid.live
// =====================================================================
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

const GROUPS = [
  { label: 'Authentication & ACL (ผู้ใช้ บทบาท สิทธิ์)', color: '#372721', tables: ['users', 'roles', 'role_permissions', 'permissions', 'permission_functions', 'app_functions'] },
  { label: 'ระบบงานร้านกาแฟ', color: '#a8461b', tables: ['menu_categories', 'menu_items', 'orders', 'order_items', 'order_status_history', 'files'] },
  { label: 'Log และ Session', color: '#5b6b68', tables: ['audit_logs', 'user_sessions'] },
];

function shortType(c) {
  switch (c.data_type) {
    case 'character varying': return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
    case 'timestamp with time zone': return 'timestamptz';
    case 'timestamp without time zone': return 'timestamp';
    case 'integer': return 'int';
    case 'boolean': return 'bool';
    default: return c.data_type;
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  const client = new Client(config.db);
  await client.connect();
  const cols = (await client.query(
    `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  )).rows;
  const cons = (await client.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.contype,
            c.confrelid::regclass::text AS ref_tbl, af.attname AS ref_col, array_length(c.conkey, 1) AS n
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       LEFT JOIN pg_attribute af ON af.attrelid = c.confrelid
             AND af.attnum = c.confkey[array_position(c.conkey, a.attnum)]
      WHERE c.contype IN ('p', 'f', 'u') AND c.connamespace = 'public'::regnamespace`,
  )).rows;
  await client.end();

  const tables = {};
  for (const c of cols) {
    (tables[c.table_name] ||= { cols: [] }).cols.push({
      name: c.column_name, type: shortType(c), nullable: c.is_nullable === 'YES', keys: new Set(),
    });
  }
  const fks = [];
  for (const k of cons) {
    const t = tables[k.tbl];
    if (!t) continue;
    const col = t.cols.find((c) => c.name === k.col);
    if (k.contype === 'p') col.keys.add('PK');
    if (k.contype === 'u' && k.n === 1) col.keys.add('UK');
    if (k.contype === 'f') {
      col.keys.add('FK');
      fks.push({ child: k.tbl, col: k.col, parent: k.ref_tbl, refCol: k.ref_col, nullable: col.nullable });
    }
  }

  // รวมเส้นที่ซ้ำคู่เดียวกัน (เช่น orders → users หลายคอลัมน์ reviewed_by, barista_id)
  const edges = new Map();
  for (const f of fks) {
    const key = `${f.child}|${f.parent}|${f.nullable}`;
    if (!edges.has(key)) edges.set(key, { ...f, cols: [] });
    edges.get(key).cols.push(f.col);
  }

  // ---------------- Graphviz ----------------
  const font = 'Loma, IBM Plex Sans Thai, Sarabun, sans-serif';
  let dot = `digraph ER {\n  graph [rankdir=LR, splines=spline, nodesep=0.5, ranksep=1.1, fontname="${font}", fontsize=16, pad=0.4, bgcolor="white", labelloc=b, labeljust=l, label="ER Diagram ระบบจัดการร้านกาแฟ Kernel Coffee (สร้างจากฐานข้อมูลจริง)  |  เส้นทึบ = FK บังคับ (1 : N)  |  เส้นประ = FK ว่างได้ (0..1 : N)  |  NN = NOT NULL, PK/FK/UK = คีย์"];\n`;
  dot += `  node [shape=plain, fontname="${font}", fontsize=11];\n  edge [fontname="${font}", fontsize=9, color="#46625d", dir=both];\n`;
  GROUPS.forEach((g, gi) => {
    dot += `  subgraph cluster_${gi} {\n    label="${g.label}"; labelloc=t; style="rounded,dashed"; color="${g.color}"; fontcolor="${g.color}";\n`;
    for (const name of g.tables) {
      const t = tables[name];
      if (!t) continue;
      let html = `<table border="0" cellborder="1" cellspacing="0" cellpadding="4" color="#9fb3ae">`;
      html += `<tr><td colspan="3" bgcolor="${g.color}"><font color="white"><b>${esc(name)}</b></font></td></tr>`;
      for (const c of t.cols) {
        const keys = [...c.keys].join(',');
        const bold = c.keys.has('PK');
        const nameCell = bold ? `<b>${esc(c.name)}</b>` : esc(c.name);
        html += `<tr><td align="left" port="${c.name}_l">${nameCell}</td><td align="left"><font color="#5b6b68">${esc(c.type)}${c.nullable ? '' : ' NN'}</font></td><td align="left" port="${c.name}_r">${keys ? `<font color="${g.color}"><b>${keys}</b></font>` : " "}</td></tr>`;
      }
      html += '</table>';
      dot += `    "${name}" [label=<${html}>];\n`;
    }
    dot += '  }\n';
  });
  for (const e of edges.values()) {
    // ฝั่งแม่ (1 หรือ 0..1)  →  ฝั่งลูก (0..N)
    const tail = e.nullable ? 'teeodot' : 'teetee';
    const style = e.nullable ? 'dashed' : 'solid';
    const label = `${e.cols.join(', ')}\\n${e.nullable ? '0..1' : '1'} : N`;
    dot += `  "${e.parent}":"${e.refCol}_r":e -> "${e.child}":"${e.cols[0]}_l":w [arrowtail=${tail}, arrowhead=crowodot, style=${style}, label="${label}"];\n`;
  }
  dot += '}\n';

  // ---------------- Mermaid ----------------
  let mmd = 'erDiagram\n';
  for (const e of edges.values()) {
    const left = e.nullable ? '|o' : '||';
    mmd += `  ${e.parent} ${left}--o{ ${e.child} : "${e.cols.join(', ')}"\n`;
  }
  for (const [name, t] of Object.entries(tables)) {
    mmd += `  ${name} {\n`;
    for (const c of t.cols) {
      const type = c.type.replace(/[()]/g, '_').replace(/_$/, '');
      const keys = [...c.keys].join(', ');
      mmd += `    ${type} ${c.name}${keys ? ` ${keys}` : ''}\n`;
    }
    mmd += '  }\n';
  }

  const out = path.join(__dirname, '..', 'docs');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'er-diagram.dot'), dot);
  fs.writeFileSync(path.join(out, 'er-diagram.mmd'), mmd);
  console.log(`✓ docs/er-diagram.dot และ docs/er-diagram.mmd (${Object.keys(tables).length} ตาราง, ${fks.length} FK)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
