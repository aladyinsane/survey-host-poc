import { json } from "@/lib/api";
import { sessionCookie } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie("", 0));
  return res;
}
