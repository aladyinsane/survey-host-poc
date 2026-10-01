import { z } from "zod";
import { audit } from "@/lib/audit";
import { json } from "@/lib/api";
import { requireAdmin } from "@/lib/adminAuth";
import { revokeResponse } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/admin/responses/[id]/revoke">) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Not found" }, 404);
  if (!(await revokeResponse(id.data)))
    return json({ error: "Only in-progress responses can be revoked" }, 409);
  await audit("admin.revoked", id.data);
  return json({ ok: true });
}
