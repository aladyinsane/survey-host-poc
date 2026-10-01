import { json } from "@/lib/api";
import { requireAdmin } from "@/lib/adminAuth";
import { recentAudit } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return json({ events: await recentAudit() });
}
