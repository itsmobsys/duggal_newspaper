import { closeDb, getDb } from '../src/db/client.js';
import { hashPassword } from '../src/lib/crypto.js';
import { newId } from '../src/lib/id.js';
import { nowIso } from '../src/lib/time.js';

/**
 * Create or update the one human who can hit the emergency brakes.
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-password' npm run admin:create
 *   npm run admin:create -- you@example.com 'long-password' --update
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const email = (args[0] ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = args[1] ?? process.env.ADMIN_PASSWORD ?? '';
  const update = process.argv.includes('--update');

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('[admin] Provide a valid email (argument or ADMIN_EMAIL).');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('[admin] Password must be at least 10 characters (argument or ADMIN_PASSWORD).');
    process.exit(1);
  }

  const db = getDb();
  const existing = await db.get<{ id: string }>(
    'SELECT id FROM admin_users WHERE lower(email) = ?',
    [email],
  );
  const now = nowIso();
  const passwordHash = await hashPassword(password);

  if (existing) {
    if (!update) {
      console.error(`[admin] ${email} already exists. Re-run with --update to reset its password.`);
      process.exit(1);
    }
    await db.run(
      `UPDATE admin_users SET password_hash = ?, disabled = 0, updated_at = ? WHERE id = ?`,
      [passwordHash, now, existing.id],
    );
    console.log(`[admin] password updated for ${email}`);
  } else {
    await db.run(
      `INSERT INTO admin_users (id, email, name, password_hash, role, disabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 0, ?, ?)`,
      [newId('adm'), email, 'Owner', passwordHash, now, now],
    );
    console.log(`[admin] owner created: ${email}`);
  }

  await closeDb();
}

main().catch((error) => {
  console.error('[admin] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
