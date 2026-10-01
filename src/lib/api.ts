import { clientIp, rateLimit } from "./rateLimit";
import { isWellFormedToken } from "./tokens";
import { findByToken, type ResponseView } from "./responses";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const tooMany = () => json({ error: "Too many requests" }, 429);
export const unauthorized = () => json({ error: "Not found" }, 404);

const MAX_BODY = 20_000;

export async function readJson(req: Request): Promise<unknown | undefined> {
  const text = await req.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Bad, missing, revoked, and expired tokens all return the same 404 so callers learn nothing.
export async function authenticate(req: Request): Promise<ResponseView | Response> {
  const ip = clientIp(req);
  if (!rateLimit(`api:${ip}`, 120, 60_000)) return tooMany();
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!isWellFormedToken(token)) {
    if (!rateLimit(`bad:${ip}`, 20, 600_000)) return tooMany();
    return unauthorized();
  }
  const found = await findByToken(token);
  if (!found) {
    if (!rateLimit(`bad:${ip}`, 20, 600_000)) return tooMany();
    return unauthorized();
  }
  return found;
}
