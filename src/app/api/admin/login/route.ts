import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson, tooMany } from "@/lib/api";
import { createSession, sessionCookie, SESSION_MS, verifyPassword } from "@/lib/adminAuth";
import { env } from "@/lib/env";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const body = z.strictObject({ password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  // Per-IP and global limits: one shared account, so also blunt distributed guessing.
  if (!rateLimit(`login:${clientIp(req)}`, 5, 600_000) || !rateLimit("login:all", 30, 600_000)) {
    return tooMany();
  }
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid login" }, 401);
  if (!verifyPassword(parsed.data.password, env().ADMIN_PASSWORD_HASH)) {
    await audit("admin.login_failed");
    return json({ error: "Invalid login" }, 401);
  }
  await audit("admin.login");
  const res = json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    sessionCookie(createSession(env().ADMIN_SESSION_SECRET), SESSION_MS / 1000),
  );
  return res;
}
