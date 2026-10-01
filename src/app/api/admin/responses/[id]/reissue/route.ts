import { z } from "zod";
import { audit } from "@/lib/audit";
import { json } from "@/lib/api";
import { requireAdmin } from "@/lib/adminAuth";
import { reissueToken } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/admin/responses/[id]/reissue">) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Not found" }, 404);
  const token = await reissueToken(id.data);
  if (!token) return json({ error: "Only in-progress responses can be reissued" }, 409);
  await audit("admin.reissued", id.data);
  return json({ token });
}
