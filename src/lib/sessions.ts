import { buildCookie, cookieValue } from "./cookies";
import { decryptJson, encryptJson } from "./crypto";
import { pool } from "./db";
import { emailHash } from "./email";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

// Respondent sessions (ADR-0003). The cookie holds a random 256-bit id; the database holds only
// its SHA-256, so sessions can be ended server-side and a database leak hands out none.

export const SESSION_COOKIE = "respondent_session";

export const DEFAULT_IDLE_SECONDS = 2 * 3600;
export const DEFAULT_TOTAL_SECONDS = 12 * 3600;
export const REMEMBER_SECONDS = 14 * 24 * 3600;

export type Session = { idHash: Buffer; email: string; emailHash: Buffer };

// Returns the Set-Cookie value. Always a fresh id: a cookie sent before sign-in is never reused.
export async function createSession(email: string, remember: boolean): Promise<string> {
  const id = generateToken();
  const idHash = hashToken(id);
  const idle = remember ? REMEMBER_SECONDS : DEFAULT_IDLE_SECONDS;
  const total = remember ? REMEMBER_SECONDS : DEFAULT_TOTAL_SECONDS;
  await pool().query(
    `INSERT INTO respondent_sessions (id_hash, email_hash, email_enc, idle_seconds, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [idHash, emailHash(email), encryptJson(email, sessionAad(idHash)), idle, total],
  );
  return sessionCookie(id, remember);
}

export function sessionCookie(id: string, remember: boolean): string {
  return buildCookie(SESSION_COOKIE, id, remember ? REMEMBER_SECONDS : undefined);
}

export function clearSessionCookie(): string {
  return buildCookie(SESSION_COOKIE, "", 0);
}

// Valid sessions also get their idle clock moved forward, in the same statement.
export async function readSession(req: Request): Promise<Session | null> {
  const id = cookieValue(req, SESSION_COOKIE);
  if (!isWellFormedToken(id)) return null;
  const idHash = hashToken(id);
  const { rows } = await pool().query(
    `UPDATE respondent_sessions SET last_seen_at = now()
     WHERE id_hash = $1 AND ended_at IS NULL AND expires_at > now()
       AND last_seen_at > now() - make_interval(secs => idle_seconds)
     RETURNING email_hash, email_enc`,
    [idHash],
  );
  if (rows.length === 0) return null;
  return {
    idHash,
    emailHash: rows[0].email_hash,
    email: decryptJson(rows[0].email_enc, sessionAad(idHash)) as string,
  };
}

export async function endSession(req: Request): Promise<boolean> {
  const id = cookieValue(req, SESSION_COOKIE);
  if (!isWellFormedToken(id)) return false;
  const { rowCount } = await pool().query(
    "UPDATE respondent_sessions SET ended_at = now() WHERE id_hash = $1 AND ended_at IS NULL",
    [hashToken(id)],
  );
  return rowCount === 1;
}

export async function endSessionsFor(eh: Buffer): Promise<void> {
  await pool().query(
    "UPDATE respondent_sessions SET ended_at = now() WHERE email_hash = $1 AND ended_at IS NULL",
    [eh],
  );
}

function sessionAad(idHash: Buffer): string {
  return `session:${idHash.toString("hex")}`;
}
