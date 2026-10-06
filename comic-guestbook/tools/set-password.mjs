#!/usr/bin/env node
// Prints the SQL that sets an account's password, for recovering the owner
// account (there is no email reset). Uses the same PBKDF2 code as the Worker.
//
//   node tools/set-password.mjs <username> [new-password]
//   npx wrangler d1 execute comic-guestbook --remote --command "<the printed SQL>"
//
// If no password is given a random temporary one is generated and printed.

import { hashPassword, temporaryPassword } from '../src/lib/crypto.ts';

const [username, given] = process.argv.slice(2);
if (!username || !/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
  console.error('usage: node tools/set-password.mjs <username> [new-password]');
  process.exit(1);
}
const password = given ?? temporaryPassword(14);
if (password.length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(1);
}
const rec = await hashPassword(password);
const sql = [
  `UPDATE users SET pass_hash='${rec.hash}', pass_salt='${rec.salt}', pass_iter=${rec.iter} WHERE username='${username}' COLLATE NOCASE;`,
  `DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username='${username}' COLLATE NOCASE);`,
].join(' ');
console.log(`New password for ${username}: ${password}\n`);
console.log('Run:\n');
console.log(`npx wrangler d1 execute comic-guestbook --remote --command "${sql}"`);
