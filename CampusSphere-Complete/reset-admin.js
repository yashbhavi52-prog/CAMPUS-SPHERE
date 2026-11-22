require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const email = String(process.env.ADMIN_EMAIL || 'admin@campussphere.local').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || 'ChangeMe@12345');
  const name = String(process.env.ADMIN_NAME || 'System Administrator').trim();

  if (!email || !password || password.length < 8) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters in your .env file.');
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'collegeeventdb'
  });

  try {
    const [tables] = await db.query("SHOW TABLES LIKE 'UserAccounts'");
    if (!tables.length) {
      throw new Error('UserAccounts table not found. Start the app once with npm run dev, then run npm run reset-admin.');
    }

    const hash = await bcrypt.hash(password, 12);
    const [existing] = await db.execute('SELECT user_id FROM UserAccounts WHERE email=? LIMIT 1', [email]);

    if (existing.length) {
      await db.execute(
        `UPDATE UserAccounts
         SET password_hash=?, full_name=?, role='admin', student_id=NULL, club_id=NULL, is_active=1
         WHERE email=?`,
        [hash, name, email]
      );
      console.log('Configured account updated as an administrator.');
    } else {
      await db.execute(
        `INSERT INTO UserAccounts (email, password_hash, full_name, role, is_active)
         VALUES (?, ?, ?, 'admin', 1)`,
        [email, hash, name]
      );
      console.log('Administrator account created.');
    }

    console.log(`Admin login email: ${email}`);
    console.log('Use the ADMIN_PASSWORD value from your local .env file. Do not share it.');
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error('Admin setup failed:', error.code || error.message);
  process.exitCode = 1;
});
