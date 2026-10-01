import { json } from "@/lib/api";
import { requireAdmin } from "@/lib/adminAuth";
import { listResponses } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return json({ responses: await listResponses() });
}
