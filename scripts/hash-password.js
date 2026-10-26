const bcrypt = require('bcryptjs');

const plain = process.argv[2];
if (!plain) {
  console.error('วิธีใช้: node scripts/hash-password.js "รหัสผ่าน"');
  process.exit(1);
}
console.log(bcrypt.hashSync(plain, 12));
