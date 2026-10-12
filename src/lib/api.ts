export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const tooMany = () => json({ error: "Too many requests. Try again later." }, 429);

const MAX_BODY = 20_000;

export async function readJson(req: Request): Promise<unknown | undefined> {
  // Refuse early on the declared size; the check after reading covers a missing or false header.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return undefined;
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
