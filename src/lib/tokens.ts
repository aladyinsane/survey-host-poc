import { createHash, randomBytes } from "node:crypto";

// A respondent's unique link is the credential: 256 random bits, shown once, stored only as a hash.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// 32 bytes in base64url is exactly 43 chars. Reject anything else before touching the database.
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}
