import { randomInt, timingSafeEqual } from "node:crypto";
import { pool } from "./db";
import { hit } from "./dbRateLimit";
import { emailHash } from "./email";
import { hmac } from "./keys";
import { codeMail, sendMail, type Mail } from "./mail";

// One-time sign-in codes (ADR-0003). Only a keyed hash of each code is stored.

export const CODE_TTL_SECONDS = 600;
export const MAX_ATTEMPTS = 5;

const HOUR = 3600;
export const LIMITS = {
  ip: { limit: 20, window: HOUR },
  email: { limit: 5, window: HOUR },
  emailDay: { limit: 10, window: 24 * HOUR },
  all: { limit: 200, window: HOUR },
  verifyIp: { limit: 30, window: HOUR },
};

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function codeHash(eh: Buffer, code: string): Buffer {
  return hmac("signin-code-v1", eh, code);
}

export function ipKey(ip: string): string {
  return hmac("rate-limit-ip-v1", ip).toString("hex");
}

export type CodeRequestResult =
  "sent" | "ip_limited" | "email_limited" | "email_day_limited" | "busy" | "send_failed";

export async function requestCode(
  email: string,
  ip: string,
  send: (m: Mail) => Promise<void> = sendMail,
): Promise<CodeRequestResult> {
  await housekeeping();
  const eh = emailHash(email);
  const ehHex = eh.toString("hex");
  if (!(await hit(`code:ip:${ipKey(ip)}`, LIMITS.ip.limit, LIMITS.ip.window))) return "ip_limited";
  if (!(await hit(`code:email:${ehHex}`, LIMITS.email.limit, LIMITS.email.window)))
    return "email_limited";
  if (!(await hit(`code:email-day:${ehHex}`, LIMITS.emailDay.limit, LIMITS.emailDay.window)))
    return "email_day_limited";
  if (!(await hit("code:all", LIMITS.all.limit, LIMITS.all.window))) return "busy";

  const code = generateCode();
  await pool().query(
    `INSERT INTO signin_codes (email_hash, code_hash, attempts, expires_at)
     VALUES ($1, $2, 0, now() + make_interval(secs => $3))
     ON CONFLICT (email_hash) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [eh, codeHash(eh, code), CODE_TTL_SECONDS],
  );
  try {
    await send(codeMail(email, code));
  } catch (e) {
    // No address or code in the log line.
    console.error("sign-in code email failed:", e instanceof Error ? e.message : "unknown error");
    await pool().query("DELETE FROM signin_codes WHERE email_hash = $1", [eh]);
    return "send_failed";
  }
  return "sent";
}

// Counts the attempt and reads the code in one statement, then deletes it on a match so a code
// works once even under parallel requests. Wrong, expired, used, and exhausted codes all fail alike.
export async function verifyCode(email: string, code: string): Promise<boolean> {
  const eh = emailHash(email);
  const { rows } = await pool().query(
    `UPDATE signin_codes SET attempts = attempts + 1
     WHERE email_hash = $1 AND expires_at > now() AND attempts < $2
     RETURNING code_hash`,
    [eh, MAX_ATTEMPTS],
  );
  if (rows.length === 0) return false;
  const stored: Buffer = rows[0].code_hash;
  const given = codeHash(eh, code);
  if (!timingSafeEqual(stored, given)) return false;
  const { rowCount } = await pool().query(
    "DELETE FROM signin_codes WHERE email_hash = $1 AND code_hash = $2",
    [eh, stored],
  );
  return rowCount === 1;
}

export async function verifyAllowed(ip: string): Promise<boolean> {
  return hit(`verify:ip:${ipKey(ip)}`, LIMITS.verifyIp.limit, LIMITS.verifyIp.window);
}

let lastHousekeeping = 0;

// Old codes, sessions, and rate-limit windows, at most every 10 minutes per process.
export async function housekeeping(now = Date.now()): Promise<void> {
  if (now - lastHousekeeping < 600_000) return;
  lastHousekeeping = now;
  await pool().query("DELETE FROM signin_codes WHERE expires_at < now() - interval '1 day'");
  await pool().query(
    `DELETE FROM respondent_sessions
     WHERE expires_at < now() - interval '1 day' OR ended_at < now() - interval '1 day'`,
  );
  await pool().query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
}
