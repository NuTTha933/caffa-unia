const fs = require('fs');
const path = require('path');
const config = require('./config');

const seedDir = path.join(config.root, 'database', 'seed-files');

async function ensureSchema(db) {
  const { rows } = await db.query("SELECT to_regclass('public.roles') AS t");
  if (rows[0].t) return false;
  const client = await db.pool.connect();
  try {
    await client.query('SET client_min_messages TO WARNING');
    for (const file of ['schema.sql', 'seed.sql']) {
      await client.query(fs.readFileSync(path.join(config.root, 'database', file), 'utf8'));
    }
  } finally {
    client.release();
  }
  return true;
}

function seedSource(file) {
  if (file.kind === 'payment_slip' && /^slip-K\d+\.png$/.test(file.original_name)) {
    return path.join(seedDir, 'slip-sample.png');
  }
  if (file.kind === 'menu_image') {
    const p = path.join(seedDir, 'menu', path.basename(file.original_name));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function restoreSeedFiles(db) {
  fs.mkdirSync(config.upload.dir, { recursive: true });
  const { rows } = await db.query('SELECT id, kind, original_name, stored_name, size_bytes FROM files');
  let restored = 0;
  for (const f of rows) {
    const dest = path.join(config.upload.dir, path.basename(f.stored_name));
    const src = seedSource(f);
    if (!src || fs.existsSync(dest)) continue;
    fs.copyFileSync(src, dest);
    const size = fs.statSync(dest).size;
    if (size !== Number(f.size_bytes)) await db.query('UPDATE files SET size_bytes = $1 WHERE id = $2', [size, f.id]);
    restored += 1;
  }
  return restored;
}

module.exports = { ensureSchema, restoreSeedFiles };
