import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/adminAuth";
import { changeOwner } from "@/lib/adminData";
import { emailSchema } from "@/lib/email";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ email: emailSchema });

export async function POST(req: Request, ctx: RouteContext<"/api/admin/responses/[id]/owner">) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Not found" }, 404);
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Enter a valid email address." }, 400);
  const result = await changeOwner(id.data, parsed.data.email);
  if (result === "not_in_progress")
    return json({ error: "Only in-progress responses can change owner" }, 409);
  if (result === "email_in_use")
    return json({ error: "That address already has a survey in progress" }, 409);
  await audit("admin.owner_changed", id.data);
  return json({ ok: true });
}
