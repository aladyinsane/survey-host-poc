import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { clientIp, rateLimit } from "./rateLimit";

// Single shared admin account for the POC. IT would replace this with SSO (Entra ID).

// Stored format: scrypt:N:r:p:salt(base64url):hash(base64url). No `$`, so it survives .env files.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const N = 16384;
  const hash = scryptSync(password, salt, 32, { N, r: 8, p: 1 });
  return `scrypt:${N}:8:1:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, hash] = stored.split(":");
  if (alg !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

// Session cookie value: "<expiryMs>.<hmac>". Stateless, so a short lifetime is the revocation.
export const SESSION_COOKIE = "admin_session";
export const SESSION_MS = 4 * 3_600_000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(secret: string, now = Date.now()): string {
  const payload = String(now + SESSION_MS);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(value: string | undefined, secret: string, now = Date.now()) {
  if (!value) return false;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return false;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(payload) > now;
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

// Cookie is HttpOnly + SameSite=Strict; Secure everywhere except local http development.
export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

// Returns a Response to send back if the request is not an authenticated admin request.
// State-changing requests must also come from our own origin (defense in depth next to SameSite).
export function requireAdmin(req: Request): Response | null {
  const deny = (status: number) =>
    Response.json({ error: "Not allowed" }, { status, headers: { "Cache-Control": "no-store" } });
  if (!rateLimit(`admin-api:${clientIp(req)}`, 120, 60_000)) return deny(429);
  if (!verifySession(cookieValue(req, SESSION_COOKIE), env().ADMIN_SESSION_SECRET))
    return deny(401);
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) return deny(403);
  }
  return null;
}
