export function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

// State-changing requests must come from our own pages (defense in depth next to SameSite).
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

// HttpOnly + SameSite=Strict; Secure everywhere except local http development.
// Without maxAgeSeconds the cookie lasts until the browser closes.
export function buildCookie(name: string, value: string, maxAgeSeconds?: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const age = maxAgeSeconds === undefined ? "" : `; Max-Age=${maxAgeSeconds}`;
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/${age}${secure}`;
}
