import { audit } from "@/lib/audit";
import { json } from "@/lib/api";
import { isSameOrigin } from "@/lib/cookies";
import { clearSessionCookie, endSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Not allowed" }, 403);
  if (await endSession(req)) await audit("session.ended");
  const res = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
}
