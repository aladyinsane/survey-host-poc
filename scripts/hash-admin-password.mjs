// Prints a value for ADMIN_PASSWORD_HASH. Usage: node scripts/hash-admin-password.mjs
// Reads the password from stdin so it never lands in shell history or process arguments.
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("Admin password (min 12 chars): ", (password) => {
  rl.close();
  if (password.length < 12) {
    console.error("Too short.");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const N = 16384;
  const hash = scryptSync(password, salt, 32, { N, r: 8, p: 1 });
  console.log(`scrypt:${N}:8:1:${salt.toString("base64url")}:${hash.toString("base64url")}`);
});
